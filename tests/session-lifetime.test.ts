/**
 * ADR-111: session lifetime policy.
 *
 * Two user-facing rules, both read live from the settings:
 *
 *   1. sessions never idle out by default; an optional timespan re-enables
 *      idle expiry
 *   2. a credential holds up to sessionsPerToken sessions (16 by default
 *      since 2026-08-24); creating a new session past the cap invalidates
 *      that credential's oldest session
 *
 * The SessionManager half is exercised through its sweep directly. The pool
 * half asserts on the 'server-evicted' event, because an eviction that does
 * not reach the transport layer is not an invalidation.
 */
import { App } from 'obsidian';
import { SessionManager } from '../src/utils/session-manager';
import { MCPServerPool } from '../src/utils/mcp-server-pool';
import { SecureObsidianAPI } from '../src/security';
import { BASELINE_SECURITY_SETTINGS } from '../src/mcp-server';
import { DEFAULT_SETTINGS } from '../src/settings/plugin-settings';

jest.mock('obsidian');

/** Drive the private sweep without waiting on the interval. */
function sweep(sm: SessionManager): void {
  (sm as unknown as { cleanupExpiredSessions(): void }).cleanupExpiredSessions();
}

function age(sm: SessionManager, sessionId: string, idleMs: number): void {
  sm.getSession(sessionId)!.lastActivityAt = Date.now() - idleMs;
}

describe('SessionManager idle expiry', () => {
  it('keeps the 1-hour default for a bare construction', () => {
    const sm = new SessionManager({});
    expect((sm as unknown as { options: { sessionTimeout: number } }).options.sessionTimeout).toBe(3600000);
  });

  it('0 means never: an idle session survives the sweep', () => {
    const sm = new SessionManager({ sessionTimeout: 0 });
    sm.getOrCreateSession('s1');
    age(sm, 's1', 365 * 24 * 3600000);

    sweep(sm);

    expect(sm.getSession('s1')).toBeTruthy();
    expect(sm.isSessionValid('s1')).toBe(true);
  });

  it('a timespan evicts idle sessions and keeps fresh ones', () => {
    const sm = new SessionManager({ sessionTimeout: 5000 });
    const evicted: string[] = [];
    sm.on('session-evicted', (data: { session: { sessionId: string } }) => evicted.push(data.session.sessionId));

    sm.getOrCreateSession('old');
    sm.getOrCreateSession('fresh');
    age(sm, 'old', 10000);

    sweep(sm);

    expect(evicted).toEqual(['old']);
    expect(sm.getSession('old')).toBeUndefined();
    expect(sm.getSession('fresh')).toBeTruthy();
    expect(sm.isSessionValid('old')).toBe(false);
  });

  it('reads the timeout through the caller’s accessor, live', () => {
    // The accessor-delegation pattern: the manager was constructed once, but
    // the sweep sees the current value — no options push, no restart.
    const state = { timeout: 0 };
    const sm = new SessionManager({
      get sessionTimeout() { return state.timeout; }
    });

    sm.getOrCreateSession('s1');
    age(sm, 's1', 10000);

    sweep(sm);
    expect(sm.getSession('s1')).toBeTruthy(); // never-expire at construction value

    state.timeout = 5000;
    sweep(sm);
    expect(sm.getSession('s1')).toBeUndefined(); // the new value applies
  });

  it('isSessionValid is false for unknown sessions regardless of policy', () => {
    const sm = new SessionManager({ sessionTimeout: 0 });
    expect(sm.isSessionValid('nope')).toBe(false);
  });
});

describe('per-token session cap', () => {
  const makeApp = (): App => ({
    vault: {
      adapter: { basePath: '/test/vault' },
      getAbstractFileByPath: () => null,
      getFiles: () => [],
      getMarkdownFiles: () => []
    },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    workspace: { getActiveFile: () => null }
  } as unknown as App);

  function makePool(settings: Record<string, unknown> = {}) {
    const app = makeApp();
    const plugin = { settings, manifest: { dir: '/test/vault/.obsidian/plugins/x' } };
    const api = new SecureObsidianAPI(app, undefined, plugin as never, BASELINE_SECURITY_SETTINGS);
    const pool = new MCPServerPool(api, 8, plugin as never);
    const evicted: string[] = [];
    pool.on('server-evicted', (data: { sessionId: string }) => evicted.push(data.sessionId));
    return { pool, settings, evicted };
  }

  it('the shipped default allows 16 sessions per credential', () => {
    expect(DEFAULT_SETTINGS.sessionsPerToken).toBe(16);
  });

  it('a missing or invalid setting falls back to one session per credential: a new session evicts the oldest', () => {
    const { pool, evicted } = makePool(); // no sessionsPerToken set → fallback 1
    pool.getOrCreateServer('s1', { identity: 'tok-a' });
    pool.getOrCreateServer('s2', { identity: 'tok-a' });

    expect(evicted).toEqual(['s1']);
    expect(pool.getStats().activeServers).toBe(1);
    expect(pool.sessionIdentityMatches('s2', 'tok-a')).toBe(true);
  });

  it('different credentials do not evict each other', () => {
    const { pool, evicted } = makePool();
    pool.getOrCreateServer('s1', { identity: 'tok-a' });
    pool.getOrCreateServer('s2', { identity: 'tok-b' });

    expect(evicted).toEqual([]);
    expect(pool.getStats().activeServers).toBe(2);
  });

  it('the primary key (no scope) is one bucket and follows the same default', () => {
    const { pool, evicted } = makePool();
    pool.getOrCreateServer('s1');
    pool.getOrCreateServer('s2');

    expect(evicted).toEqual(['s1']);
    expect(pool.getStats().activeServers).toBe(1);
  });

  it('a configured cap holds that many sessions, then evicts the least recently active', () => {
    // Deterministic clock: at full speed every call lands in the same
    // millisecond, and the least-recently-active ordering would reduce to
    // creation order (the sort is stable), evicting s1 instead of s2.
    let now = 1000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { pool, settings, evicted } = makePool({ sessionsPerToken: 2 });
      void settings;
      pool.getOrCreateServer('s1', { identity: 'tok-a' });
      now += 10;
      pool.getOrCreateServer('s2', { identity: 'tok-a' });
      now += 10;
      expect(evicted).toEqual([]);

      // Touch s1 so s2 is the least recently active, then exceed the cap.
      pool.getOrCreateServer('s1', { identity: 'tok-a' });
      now += 10;
      pool.getOrCreateServer('s3', { identity: 'tok-a' });

      expect(evicted).toEqual(['s2']);
      expect(pool.sessionIdentityMatches('s1', 'tok-a')).toBe(true);
      expect(pool.sessionIdentityMatches('s3', 'tok-a')).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('reads the cap live: widening it stops the evictions', () => {
    const { pool, settings, evicted } = makePool({ sessionsPerToken: 1 });
    pool.getOrCreateServer('s1', { identity: 'tok-a' });
    pool.getOrCreateServer('s2', { identity: 'tok-a' });
    expect(evicted).toEqual(['s1']);

    settings.sessionsPerToken = 5;
    pool.getOrCreateServer('s3', { identity: 'tok-a' });
    pool.getOrCreateServer('s4', { identity: 'tok-a' });
    expect(evicted).toEqual(['s1']);
    // s1 was already evicted, so s2 + s3 + s4 remain.
    expect(pool.getStats().activeServers).toBe(3);
  });

  it('fails closed to 1 on hand-edited values', () => {
    for (const bad of [0, -2, NaN, 'three']) {
      const { pool, evicted } = makePool({ sessionsPerToken: bad });
      pool.getOrCreateServer('s1', { identity: 'tok-a' });
      pool.getOrCreateServer('s2', { identity: 'tok-a' });
      expect(evicted).toEqual(['s1']);
    }
  });
});
