/**
 * Resource registry pins: the obsidian://resources/ namespace, its
 * canonical URIs (tool reference pages, infos/*, dataview), and the
 * refusal of everything else. A foreign namespace (for example snippets)
 * must never be swallowed by resolution.
 */
import { App } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import type { SessionManager } from '../src/utils/session-manager';
import {
  buildResourceList,
  readResource,
  RESOURCES_URI_PREFIX
} from '../src/resources/registry';
import { ResourceDeps, ResourceError } from '../src/resources/types';

function makeApp(withDataview = false): App {
  const files = [{ path: 'a.md' }, { path: 'b.md' }];
  return {
    vault: {
      getName: () => 'TestVault'
      , adapter: { basePath: '/test/vault' }
      , getAllLoadedFiles: () => files
      , getMarkdownFiles: () => files
    }
    , workspace: { getActiveFile: () => null }
    , ...(withDataview ? {
      plugins: {
        enabledPlugins: new Set(['dataview'])
        , plugins: { dataview: { manifest: {}, api: {} } }
      }
    } : {})
  } as unknown as App;
}

function makeAPI(withDataview = false): ObsidianAPI {
  const app = makeApp(withDataview);
  return { getApp: () => app } as unknown as ObsidianAPI;
}

function makeSessionManager(sessionIds: string[]): SessionManager {
  const now = Date.now();
  return {
    getAllSessions: () => sessionIds.map((sessionId, i) => ({
      sessionId
      , createdAt: now - 1000 * (i + 1)
      , lastActivityAt: now - 500 * (i + 1)
      , requestCount: i + 1
    }))
    , getStats: () => ({
      activeSessions: sessionIds.length
      , maxSessions: 16
      , oldestSessionAge: 1000 * sessionIds.length
      , newestSessionAge: 1000
      , totalRequests: sessionIds.length
    })
  } as unknown as SessionManager;
}

function makeDeps(overrides: Partial<ResourceDeps> = {}): ResourceDeps {
  return {
    obsidianAPI: makeAPI()
    , sessionId: 's1'
    , serverPoolStats: { activeServers: 1, maxServers: 4, utilization: '25%', totalRequests: 10 }
    , sessionPolicy: { sessionTimeoutLabel: 'never', sessionsPerTokenLimit: 16, maxConcurrentConnections: 4 }
    , ...overrides
  };
}

describe('buildResourceList', () => {
  it('lists the tool reference pages, syntax pages, infos, and session with a session manager', () => {
    const entries = buildResourceList(makeDeps({ sessionManager: makeSessionManager(['s1']) }));
    expect(entries.map(e => e.uri)).toEqual([
      `${RESOURCES_URI_PREFIX}files`
      , `${RESOURCES_URI_PREFIX}edit`
      , `${RESOURCES_URI_PREFIX}view`
      , `${RESOURCES_URI_PREFIX}graph`
      , `${RESOURCES_URI_PREFIX}bases`
      , `${RESOURCES_URI_PREFIX}system`
      , `${RESOURCES_URI_PREFIX}syntax/markdown`
      , `${RESOURCES_URI_PREFIX}syntax/internal-links`
      , `${RESOURCES_URI_PREFIX}syntax/callouts`
      , `${RESOURCES_URI_PREFIX}syntax/mermaid`
      , `${RESOURCES_URI_PREFIX}syntax/canvas`
      , `${RESOURCES_URI_PREFIX}syntax/bases`
      , `${RESOURCES_URI_PREFIX}syntax/custom-css`
      , `${RESOURCES_URI_PREFIX}syntax/search`
      , `${RESOURCES_URI_PREFIX}syntax/properties`
      , `${RESOURCES_URI_PREFIX}syntax/tags`
      , `${RESOURCES_URI_PREFIX}infos/vault`
      , `${RESOURCES_URI_PREFIX}infos/session`
    ]);
  });

  it('omits infos/session when no session manager exists', () => {
    const entries = buildResourceList(makeDeps());
    expect(entries.map(e => e.uri)).toContain(`${RESOURCES_URI_PREFIX}infos/vault`);
    expect(entries.map(e => e.uri)).not.toContain(`${RESOURCES_URI_PREFIX}infos/session`);
  });

  it('adds dataview when the dataview plugin is ready', () => {
    const entries = buildResourceList(makeDeps({ obsidianAPI: makeAPI(true) }));
    expect(entries.map(e => e.uri)).toContain(`${RESOURCES_URI_PREFIX}dataview`);
  });
});

describe('readResource: infos resources', () => {
  it('serves infos/vault from the canonical URI', () => {
    const content = readResource(`${RESOURCES_URI_PREFIX}infos/vault`, makeDeps());
    expect(content.uri).toBe(`${RESOURCES_URI_PREFIX}infos/vault`);
    expect(content.mimeType).toBe('application/json');
    const parsed = JSON.parse(content.text);
    expect(parsed.vault.name).toBe('TestVault');
    expect(parsed.vault.path).toBe('/test/vault');
    expect(parsed.plugin.sessionId).toBe('s1');
  });

  it('serves infos/session with the reading session marked current', () => {
    const deps = makeDeps({ sessionManager: makeSessionManager(['other', 's1']) });
    const content = readResource(`${RESOURCES_URI_PREFIX}infos/session`, deps);
    const parsed = JSON.parse(content.text);
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions[0].sessionId).toBe('s1');
    expect(parsed.sessions[0].isCurrentSession).toBe(true);
    expect(parsed.settings.maxConcurrentConnections).toBe(4);
  });

  it('refuses infos/session when no session manager exists', () => {
    expect(() => readResource(`${RESOURCES_URI_PREFIX}infos/session`, makeDeps()))
      .toThrow(ResourceError);
  });
});

describe('readResource: tool reference pages', () => {
  it('serves a detailed markdown page for each tool', () => {
    for (const tool of ['files', 'edit', 'view', 'graph', 'bases', 'system']) {
      const content = readResource(`${RESOURCES_URI_PREFIX}${tool}`, makeDeps());
      expect(content.uri).toBe(`${RESOURCES_URI_PREFIX}${tool}`);
      expect(content.mimeType).toBe('text/markdown');
      expect(content.text.startsWith(`# ${tool}`)).toBe(true);
      expect(content.text).toContain('## Actions');
    }
  });

  it('serves a detailed markdown page for each syntax category', () => {
    const pages: Array<[string, string]> = [
      ['syntax/markdown', '# Markdown']
      , ['syntax/internal-links', '# Internal links']
      , ['syntax/callouts', '# Callouts']
      , ['syntax/mermaid', '# Mermaid']
      , ['syntax/canvas', '# Canvas']
      , ['syntax/bases', '# Bases']
      , ['syntax/custom-css', '# Custom CSS']
      , ['syntax/search', '# Search']
      , ['syntax/properties', '# Properties']
      , ['syntax/tags', '# Tags']
    ];
    for (const [name, heading] of pages) {
      const content = readResource(`${RESOURCES_URI_PREFIX}${name}`, makeDeps());
      expect(content.uri).toBe(`${RESOURCES_URI_PREFIX}${name}`);
      expect(content.mimeType).toBe('text/markdown');
      expect(content.text.startsWith(heading)).toBe(true);
      expect(content.text.length).toBeGreaterThan(500);
    }
  });

  it('the internal-links page documents the link format settings check', () => {
    const content = readResource(`${RESOURCES_URI_PREFIX}syntax/internal-links`, makeDeps());
    expect(content.text).toContain('obsidian://config/newLinkFormat');
    expect(content.text).toContain('"absolute"');
  });

  it('serves the dataview reference as markdown when dataview is ready', () => {
    const deps = makeDeps({ obsidianAPI: makeAPI(true) });
    const content = readResource(`${RESOURCES_URI_PREFIX}dataview`, deps);
    expect(content.mimeType).toBe('text/markdown');
    expect(content.text.startsWith('# Dataview')).toBe(true);
  });
});

describe('readResource: refusals', () => {
  it('refuses the retired flat names', () => {
    for (const uri of ['obsidian://vault-info', 'obsidian://resources/vault-info', 'obsidian://resources/session-info', 'obsidian://resources/dataview-reference']) {
      try {
        readResource(uri, makeDeps());
        throw new Error(`expected UNKNOWN_RESOURCE for ${uri}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ResourceError);
        expect((e as ResourceError).code).toBe('UNKNOWN_RESOURCE');
      }
    }
  });

  it('never swallows a foreign namespace as a resource name', () => {
    for (const uri of ['obsidian://snippets/theme.css', 'obsidian://config/cssTheme', 'obsidian://resources/', 'obsidian://resources/infos/nope']) {
      try {
        readResource(uri, makeDeps());
        throw new Error(`expected UNKNOWN_RESOURCE for ${uri}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ResourceError);
        expect((e as ResourceError).code).toBe('UNKNOWN_RESOURCE');
      }
    }
  });

  it('refuses a non-obsidian path outright', () => {
    expect(() => readResource('notes/a.md', makeDeps())).toThrow(ResourceError);
  });
});
