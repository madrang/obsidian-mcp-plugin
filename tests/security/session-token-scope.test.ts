/**
 * ADR-110: folder-scoped and read-only tokens must hold on REAL sessions.
 *
 * The auth decision only carries the scope; enforcement lives in the
 * per-session SecureObsidianAPI the pool builds. This covers the wiring
 * between them:
 *
 *   1. a scoped session gets the wrapped plugin ref (folder-scoped ignore
 *      manager, token read-only folded into the live predicate)
 *   2. a session is bound to the credential that created it, and a different
 *      credential replaying the session ID is refused
 *   3. out-of-folder writes through a scoped session record ZERO vault writes
 *      — asserted on recorded writes, not error strings
 */
import { App, TFile, TFolder } from 'obsidian';

jest.mock('obsidian');

/** Same wrapping trick as session-api-enforcement: the pool binds to this
 * subclass, and we record both constructor args and instances. */
const constructorCalls: unknown[][] = [];
const instances: import('../../src/security/secure-obsidian-api').SecureObsidianAPI[] = [];
jest.mock('../../src/security/secure-obsidian-api', () => {
  const actual = jest.requireActual('../../src/security/secure-obsidian-api');
  class Recording extends actual.SecureObsidianAPI {
    constructor(...args: unknown[]) {
      constructorCalls.push(args);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- forwarding the real signature verbatim
      super(...(args as Parameters<typeof actual.SecureObsidianAPI>));
      instances.push(this as unknown as import('../../src/security/secure-obsidian-api').SecureObsidianAPI);
    }
  }
  return { ...actual, SecureObsidianAPI: Recording };
});

// Imported after the mock so the pool binds to the wrapper.
import { MCPServerPool } from '../../src/utils/mcp-server-pool';
import { SecureObsidianAPI, SecurityError } from '../../src/security';
import { FolderScopedIgnoreManager } from '../../src/security/token-scope';
import { BASELINE_SECURITY_SETTINGS } from '../../src/security/baseline-settings';

type Write = { op: string; path: string };

function mkFile(p: string): TFile {
  const f = new TFile();
  const w = f as unknown as { path: string; extension: string; name: string };
  w.path = p;
  w.extension = 'md';
  w.name = p;
  return f;
}

function mkFolder(p: string, children: TFile[]): TFolder {
  const f = new TFolder();
  (f as unknown as { path: string; name: string }).path = p;
  (f as unknown as { path: string; name: string }).name = p;
  f.children = children;
  return f;
}

function makeApp(existing: string[], writes: Write[]): App {
  const has = (p: string) => existing.includes(p);
  return {
    vault: {
      adapter: { basePath: '/test/vault' },
      getAbstractFileByPath: (p: string) => {
        if (p === 'Projects') return mkFolder('Projects', [mkFile('Projects/a.md')]);
        return has(p) ? mkFile(p) : null;
      },
      read: async () => 'body\n',
      cachedRead: async () => 'body\n',
      modify: async (f: TFile, _c: string) => { writes.push({ op: 'modify', path: f.path }); },
      create: async (p: string, _c: string) => { writes.push({ op: 'create', path: p }); return mkFile(p); },
      // Folder creation is incidental to createFile; not recorded as a write.
      createFolder: async () => undefined,
      getFiles: () => existing.map(mkFile),
      getAllLoadedFiles: () => existing.map(mkFile),
    },
    fileManager: { renameFile: async () => undefined, trashFile: async () => undefined },
    metadataCache: { getFileCache: () => ({}), resolvedLinks: {} },
    workspace: { getActiveFile: () => null },
  } as unknown as App;
}

function makePool(writes: Write[], existing: string[] = ['Projects/a.md', 'Notes/b.md', 'secret.md']) {
  const app = makeApp(existing, writes);
  const plugin = { settings: { readOnlyMode: false } };
  const parent = new SecureObsidianAPI(app, undefined, plugin as never, BASELINE_SECURITY_SETTINGS);
  const pool = new MCPServerPool(parent, 8, plugin as never);
  constructorCalls.length = 0;
  instances.length = 0;
  return { app, plugin, pool };
}

describe('session token scope (ADR-110)', () => {
  it('an unscoped session keeps the live plugin reference, by identity', () => {
    const { plugin, pool } = makePool([]);
    pool.getOrCreateServer('s-plain');
    expect(constructorCalls.length).toBeGreaterThan(0);
    expect(constructorCalls[0][2]).toBe(plugin);
  });

  it('a scoped session gets the wrapped ref: scoped manager, live read-only', () => {
    const { plugin, pool } = makePool([]);
    pool.getOrCreateServer('s-scoped', { identity: 'tok-1', scopes: [{ folder: 'Projects', readOnly: true }] });

    const sessionPlugin = constructorCalls[0][2] as {
      settings?: { readOnlyMode?: boolean };
      ignoreManager?: unknown;
    };
    expect(sessionPlugin).not.toBe(plugin);
    expect(sessionPlugin.ignoreManager).toBeInstanceOf(FolderScopedIgnoreManager);
    // Token read-only is visible through the wrapper while the real setting stays off.
    expect(sessionPlugin.settings?.readOnlyMode).toBe(true);
    expect(plugin.settings.readOnlyMode).toBe(false);
  });

  it('the wrapped ref still tracks the global read-only toggle live', () => {
    const { plugin, pool } = makePool([]);
    pool.getOrCreateServer('s-live', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });

    const sessionPlugin = constructorCalls[0][2] as { settings?: { readOnlyMode?: boolean } };
    expect(sessionPlugin.settings?.readOnlyMode).toBe(false);
    plugin.settings.readOnlyMode = true;
    expect(sessionPlugin.settings?.readOnlyMode).toBe(true);
  });

  it('a scoped token without a folder keeps the base ignore manager', () => {
    const { plugin, pool } = makePool([]);
    pool.getOrCreateServer('s-nofolder', { identity: 'tok-1' });

    const sessionPlugin = constructorCalls[0][2] as { ignoreManager?: unknown };
    expect(sessionPlugin.ignoreManager).toBe((plugin as { ignoreManager?: unknown }).ignoreManager);
  });

  describe('sessionIdentityMatches', () => {
    it('accepts any identity for an unknown session (creation binds it)', () => {
      const { pool } = makePool([]);
      expect(pool.sessionIdentityMatches('unknown-session', 'tok-1')).toBe(true);
      expect(pool.sessionIdentityMatches('unknown-session', undefined)).toBe(true);
    });

    it('binds the creating credential and refuses every other', () => {
      const { pool } = makePool([]);
      pool.getOrCreateServer('s-bound', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });

      expect(pool.sessionIdentityMatches('s-bound', 'tok-1')).toBe(true);
      // A different scoped token must not ride the session.
      expect(pool.sessionIdentityMatches('s-bound', 'tok-2')).toBe(false);
      // The primary key (no identity) must not ride a scoped session either.
      expect(pool.sessionIdentityMatches('s-bound', undefined)).toBe(false);
    });

    it('a full-access session refuses a scoped token replaying its ID', () => {
      const { pool } = makePool([]);
      pool.getOrCreateServer('s-full');

      expect(pool.sessionIdentityMatches('s-full', undefined)).toBe(true);
      expect(pool.sessionIdentityMatches('s-full', 'tok-1')).toBe(false);
    });
  });

  describe('multi-scope sessions (per-scope options)', () => {
    it('writes land in a writable scope and are refused in a read-only scope', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-mixed', {
        identity: 'tok-mixed'
        , scopes: [{ folder: 'Projects' }, { folder: 'Notes', readOnly: true }]
      });
      const api = instances[0];

      await api.createFile('Projects/new.md', 'x');
      await expect(api.createFile('Notes/evil.md', 'x')).rejects.toThrow('read-only scope');
      expect(writes).toEqual([{ op: 'create', path: 'Projects/new.md' }]);
    });

    it('a scoped session reads the resources namespace', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-res', { identity: 'tok-res', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];

      // The scope gate passed iff the call reaches the resource-service
      // check. PATH_BLOCKED means the namespace stayed out of scope.
      const error = await api.getFile('obsidian://resources/view').then(
        () => null
        , (e: Error) => e
      );
      expect(error?.message).toContain('not wired');
    });
  });

  describe('view.active answers out-of-scope with nothing', () => {
    function setActive(app: App, path: string | null): void {
      (app.workspace as unknown as { getActiveFile: () => TFile | null }).getActiveFile =
        () => (path === null ? null : mkFile(path));
    }

    it('an out-of-scope active file answers as no active file, path unnamed', async () => {
      const { app, pool } = makePool([]);
      pool.getOrCreateServer('s-active-out', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];
      setActive(app, 'Notes/b.md');

      const error = await api.getActiveFile().then(
        () => { throw new Error('expected a refusal'); }
        , (e: Error) => e
      );
      expect(error.message).toBe('No active file');
      expect(String(error)).not.toContain('Notes/b.md');
    });

    it('an in-scope active file is served', async () => {
      const { app, pool } = makePool([]);
      pool.getOrCreateServer('s-active-in', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];
      setActive(app, 'Projects/a.md');

      const file = await api.getActiveFile();
      expect((file as { path: string }).path).toBe('Projects/a.md');
    });

    it('no active file stays the plain no-active-file error', async () => {
      const { app, pool } = makePool([]);
      pool.getOrCreateServer('s-active-none', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];
      setActive(app, null);

      await expect(api.getActiveFile()).rejects.toThrow('No active file');
    });
  });

  describe('enforcement on the session API', () => {
    it('reads inside the folder work, reads outside are blocked', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-read', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];

      const inside = await api.getFile('Projects/a.md');
      expect(inside).toBeTruthy();

      await expect(api.getFile('secret.md')).rejects.toThrow(SecurityError);
      await expect(api.getFile('Notes/b.md')).rejects.toThrow(SecurityError);
    });

    it('writes outside the folder record zero vault writes', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-write', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];

      await expect(api.createFile('Notes/evil.md', 'x')).rejects.toThrow(SecurityError);
      await expect(api.updateFile('secret.md', 'x')).rejects.toThrow(SecurityError);
      expect(writes).toEqual([]);
    });

    it('writes inside the folder land', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-write-ok', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];

      await api.createFile('Projects/new.md', 'x');
      expect(writes).toEqual([{ op: 'create', path: 'Projects/new.md' }]);
    });

    it('a read-only token cannot write even inside its folder', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-ro', { identity: 'tok-1', scopes: [{ folder: 'Projects', readOnly: true }] });
      const api = instances[0];

      await expect(api.createFile('Projects/new.md', 'x')).rejects.toThrow(SecurityError);
      expect(writes).toEqual([]);
    });

    it('folder listing is filtered to the folder', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-list', { identity: 'tok-1', scopes: [{ folder: 'Projects' }] });
      const api = instances[0];

      const listed = await api.listFiles('Projects');
      expect(listed).toEqual(['Projects/a.md']);
    });

    it('an unscoped session lists the vault root for every root spelling', async () => {
      const writes: Write[] = [];
      const { pool } = makePool(writes);
      pool.getOrCreateServer('s-root');
      const api = instances[0];

      const all = ['Notes/b.md', 'Projects/a.md', 'secret.md'];
      // listFiles funnels '', '/', and an absent directory to '.', and the
      // hidden-path guard must let the root marker through.
      await expect(api.listFiles()).resolves.toEqual(all);
      await expect(api.listFiles('/')).resolves.toEqual(all);
      await expect(api.listFiles('.')).resolves.toEqual(all);
    });
  });
});
