/**
 * Managed URI namespaces: obsidian://snippets/ and obsidian://config/
 * (ADR-113).
 *
 * These tests assert on RECORDED WRITES, not error strings: the adapter
 * (write, remove) and the config API (setConfig) are recording mocks, and
 * every refusal case asserts nothing landed before the error is checked.
 */
import { App } from 'obsidian';
import { SecureObsidianAPI } from '../../src/security/secure-obsidian-api';
import { FolderScopedIgnoreManager } from '../../src/security/token-scope';
import { SecurityError } from '../../src/security';

const PERMISSIVE = {
  pathValidation: 'strict' as const,
  permissions: {
    read: true, create: true, update: true,
    delete: true, move: true, execute: true,
  },
  blockedPaths: [],
  logSecurityEvents: false,
};

interface AdapterOp {
  op: 'read' | 'write' | 'remove' | 'list' | 'mkdir';
  path: string;
  content?: string;
}

interface ConfigCall {
  key: string;
  value: unknown;
}

function makeApp(opts: {
  snippets?: Record<string, string>;
  config?: Record<string, unknown>;
  localStorage?: Record<string, unknown>;
  withCustomCss?: boolean;
} = {}) {
  const adapterOps: AdapterOp[] = [];
  const configCalls: ConfigCall[] = [];
  const configReads: string[] = [];
  const lsCalls: Array<{ key: string; value: unknown }> = [];
  const lsReads: string[] = [];
  const workspaceEvents: string[] = [];
  const toggleCalls: Array<{ id: string; enabled: boolean }> = [];
  const lsStore = new Map<string, unknown>(Object.entries(opts.localStorage ?? {}));
  // The app's getConfig falls back to the defaults registry (verified
  // 1.13.7): enabledCssSnippets always answers, unset reads as [].
  const configDefaults = new Map<string, unknown>([['enabledCssSnippets', []]]);
  const snippetFiles = new Map<string, string>(
    Object.entries(opts.snippets ?? {}).map(([name, content]) => [`.obsidian/snippets/${name}`, content])
  );
  const config = new Map<string, unknown>(Object.entries(opts.config ?? {}));

  const adapter = {
    basePath: '/test/vault'
    , exists: async (p: string) => snippetFiles.has(p)
    , read: async (p: string) => {
      const content = snippetFiles.get(p);
      if (content === undefined) throw new Error(`missing: ${p}`);
      adapterOps.push({ op: 'read', path: p });
      return content;
    }
    , write: async (p: string, data: string) => {
      adapterOps.push({ op: 'write', path: p, content: data });
      snippetFiles.set(p, data);
    }
    , remove: async (p: string) => {
      adapterOps.push({ op: 'remove', path: p });
      snippetFiles.delete(p);
    }
    , list: async (p: string) => ({
      files: [...snippetFiles.keys()].filter((k) => k.startsWith(p + '/'))
      , folders: []
    })
    , mkdir: async () => {}
    , stat: async (p: string) => ({
      type: 'file' as const
      , mtime: 1700000000000
      , size: (snippetFiles.get(p) ?? '').length
      , ctime: 1700000000000
    })
  };

  const app = {
    vault: {
      configDir: '.obsidian'
      , adapter
      , getName: () => 'TestVault'
      , getAbstractFileByPath: () => null
      , getAllLoadedFiles: () => []
      , getMarkdownFiles: () => []
      , getConfig: (key: string) => {
        configReads.push(key);
        return config.has(key) ? config.get(key) : configDefaults.get(key);
      }
      , setConfig: (key: string, value: unknown) => {
        configCalls.push({ key, value });
        config.set(key, value);
      }
    }
    , loadLocalStorage: (key: string) => {
      lsReads.push(key);
      return lsStore.get(key);
    }
    , saveLocalStorage: (key: string, value: unknown) => {
      lsCalls.push({ key, value });
      lsStore.set(key, value);
    }
    , workspace: {
      getActiveFile: () => null
      , trigger: (name: string) => workspaceEvents.push(name)
    }
    , ...(opts.withCustomCss ? {
      customCss: {
        setCssEnabledStatus: (id: string, enabled: boolean) => toggleCalls.push({ id, enabled })
      }
    } : {})
  } as unknown as App;

  return { app, adapterOps, configCalls, configReads, lsCalls, lsReads, workspaceEvents, toggleCalls, snippetFiles, config };
}

function makeApi(
  app: App,
  settings: { allowSnippetEditing?: boolean; allowConfigEditing?: boolean; readOnlyMode?: boolean } = {},
  ignoreManager?: FolderScopedIgnoreManager
) {
  return new SecureObsidianAPI(app, undefined, { settings, ignoreManager } as never, PERMISSIVE);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<SecurityError | Error> {
  try {
    await promise;
    throw new Error(`expected error code ${code}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return error as SecurityError;
  }
}

describe('snippets namespace gate', () => {
  it('reads a snippet with both toggles off: reads are open', async () => {
    const { app, adapterOps } = makeApp({ snippets: { 'theme.css': 'body { color: red; }' } });
    const api = makeApi(app);

    const file = await api.getFile('obsidian://snippets/theme.css');
    expect((file as { content: string }).content).toContain('color: red');
    expect(adapterOps.map((o) => o.op)).toEqual(['read']);
  });

  it('blocks a snippet write with the toggle off: zero recorded writes', async () => {
    const { app, adapterOps } = makeApp({ snippets: { 'theme.css': 'body {}' } });
    const api = makeApi(app);

    await expectCode(api.updateFile('obsidian://snippets/theme.css', 'body { color: blue; }'), 'SNIPPET_WRITE_DISABLED');
    expect(adapterOps.filter((o) => o.op === 'write')).toEqual([]);
  });

  it('writes a snippet with the toggle on: the write is recorded', async () => {
    const { app, adapterOps } = makeApp({ snippets: { 'theme.css': 'body {}' } });
    const api = makeApi(app, { allowSnippetEditing: true });

    await api.updateFile('obsidian://snippets/theme.css', 'body { color: blue; }');
    expect(adapterOps.filter((o) => o.op === 'write')).toEqual([
      { op: 'write', path: '.obsidian/snippets/theme.css', content: 'body { color: blue; }' }
    ]);
  });

  it('read-only mode blocks a snippet write even with the toggle on', async () => {
    const { app, adapterOps } = makeApp({ snippets: { 'theme.css': 'body {}' } });
    const api = makeApi(app, { allowSnippetEditing: true, readOnlyMode: true });

    await expectCode(api.updateFile('obsidian://snippets/theme.css', 'x'), 'PERMISSION_DENIED');
    expect(adapterOps.filter((o) => o.op === 'write')).toEqual([]);
  });

  it('refuses malformed snippet names: zero adapter operations', async () => {
    const { app, adapterOps } = makeApp({ snippets: { 'theme.css': 'body {}' } });
    const api = makeApi(app, { allowSnippetEditing: true });

    for (const uri of [
      'obsidian://snippets/../plugins/scoped-vault-mcp/data.json'
      , 'obsidian://snippets/a/b.css'
      , 'obsidian://snippets/theme.txt'
      , 'obsidian://snippets/.hidden.css'
    ]) {
      await expectCode(api.getFile(uri), 'INVALID_SNIPPET_NAME');
      await expectCode(api.updateFile(uri, 'x'), 'INVALID_SNIPPET_NAME');
    }
    expect(adapterOps).toEqual([]);
  });

  it('still rejects a raw .obsidian path with HIDDEN_PATH', async () => {
    const { app, adapterOps } = makeApp({ snippets: { 'theme.css': 'body {}' } });
    const api = makeApi(app, { allowSnippetEditing: true });

    await expectCode(api.getFile('.obsidian/snippets/theme.css'), 'HIDDEN_PATH');
    await expectCode(api.updateFile('.obsidian/snippets/theme.css', 'x'), 'HIDDEN_PATH');
    expect(adapterOps).toEqual([]);
  });

  it('refuses an unknown obsidian:// namespace outright', async () => {
    const { app, adapterOps } = makeApp();
    const api = makeApi(app);

    await expectCode(api.getFile('obsidian://other/thing'), 'FORBIDDEN_PATTERN');
    expect(adapterOps).toEqual([]);
  });
});

describe('snippet delete interlock', () => {
  it('refuses to delete an enabled snippet: SNIPPET_ENABLED, zero removals', async () => {
    const { app, adapterOps } = makeApp({
      snippets: { 'theme.css': 'body {}' }
      , config: { enabledCssSnippets: ['theme'] }
    });
    const api = makeApi(app, { allowSnippetEditing: true });

    const error = await expectCode(api.deleteFile('obsidian://snippets/theme.css'), 'SNIPPET_ENABLED');
    expect((error as Error).message).toContain('disable');
    expect(adapterOps.filter((o) => o.op === 'remove')).toEqual([]);
  });

  it('deletes a disabled snippet: the removal is recorded', async () => {
    const { app, adapterOps } = makeApp({
      snippets: { 'theme.css': 'body {}' }
      , config: { enabledCssSnippets: ['other'] }
    });
    const api = makeApi(app, { allowSnippetEditing: true });

    await api.deleteFile('obsidian://snippets/theme.css');
    expect(adapterOps.filter((o) => o.op === 'remove')).toEqual([
      { op: 'remove', path: '.obsidian/snippets/theme.css' }
    ]);
  });
});

describe('config namespace gate', () => {
  it('reads a config key as JSON text with both toggles off', async () => {
    const { app, configReads } = makeApp({ config: { cssTheme: 'Minimal' } });
    const api = makeApi(app);

    const file = await api.getFile('obsidian://config/cssTheme');
    expect((file as { content: string }).content).toBe('"Minimal"\n');
    expect(configReads).toContain('cssTheme');
  });

  it('serves an object value as pretty-printed JSON', async () => {
    const { app } = makeApp({ config: { enabledCssSnippets: ['theme'] } });
    const api = makeApi(app);

    const file = await api.getFile('obsidian://config/enabledCssSnippets');
    expect((file as { content: string }).content).toBe('[\n  "theme"\n]\n');
  });

  it('blocks a config write with the toggle off: zero setConfig calls', async () => {
    const { app, configCalls } = makeApp({ config: { cssTheme: 'Minimal' } });
    const api = makeApi(app);

    await expectCode(api.updateFile('obsidian://config/cssTheme', '"Other"'), 'CONFIG_WRITE_DISABLED');
    expect(configCalls).toEqual([]);
  });

  it('refuses invalid JSON before setConfig runs, with the toggle on', async () => {
    const { app, configCalls } = makeApp({ config: { cssTheme: 'Minimal' } });
    const api = makeApi(app, { allowConfigEditing: true });

    await expectCode(api.updateFile('obsidian://config/cssTheme', '"unterminated'), 'INVALID_CONFIG_JSON');
    expect(configCalls).toEqual([]);
  });

  it('applies a valid JSON edit with the toggle on: setConfig is recorded', async () => {
    const { app, configCalls } = makeApp({ config: { enabledCssSnippets: ['theme'] } });
    const api = makeApi(app, { allowConfigEditing: true });

    await api.updateFile('obsidian://config/enabledCssSnippets', '[\n  "theme",\n  "other"\n]\n');
    expect(configCalls).toEqual([
      { key: 'enabledCssSnippets', value: ['theme', 'other'] }
    ]);
  });

  it('read-only mode blocks a config write even with the toggle on', async () => {
    const { app, configCalls } = makeApp({ config: { cssTheme: 'Minimal' } });
    const api = makeApi(app, { allowConfigEditing: true, readOnlyMode: true });

    await expectCode(api.updateFile('obsidian://config/cssTheme', '"Other"'), 'PERMISSION_DENIED');
    expect(configCalls).toEqual([]);
  });

  it('refuses create and delete on config keys: CONFIG_ACTION_UNSUPPORTED', async () => {
    const { app, configCalls } = makeApp({ config: { cssTheme: 'Minimal' } });
    const api = makeApi(app, { allowConfigEditing: true, allowSnippetEditing: true });

    await expectCode(api.createFile('obsidian://config/cssTheme', '"x"'), 'CONFIG_ACTION_UNSUPPORTED');
    await expectCode(api.deleteFile('obsidian://config/cssTheme'), 'CONFIG_ACTION_UNSUPPORTED');
    expect(configCalls).toEqual([]);
  });

  it('refuses malformed config keys: zero config API calls', async () => {
    const { app, configCalls, configReads } = makeApp({ config: { cssTheme: 'x' } });
    const api = makeApi(app, { allowConfigEditing: true });

    for (const uri of ['obsidian://config/../x', 'obsidian://config/a/b', 'obsidian://config/.hidden']) {
      await expectCode(api.getFile(uri), 'INVALID_CONFIG_KEY');
    }
    expect(configCalls).toEqual([]);
    expect(configReads).toEqual([]);
  });

  it('answers an unknown key as not found', async () => {
    const { app } = makeApp();
    const api = makeApi(app);

    await expect(api.getFile('obsidian://config/noSuchKey')).rejects.toThrow('File not found');
    const stat = await api.getFileStat('obsidian://config/noSuchKey');
    expect((stat as { exists: boolean }).exists).toBe(false);
  });
});

describe('localStorage-backed config keys', () => {
  it('reads mermaid-vault-trust with both toggles off, through localStorage only', async () => {
    const { app, lsReads, configReads } = makeApp({ localStorage: { 'mermaid-vault-trust': true } });
    const api = makeApi(app);

    const file = await api.getFile('obsidian://config/mermaid-vault-trust');
    expect((file as { content: string }).content).toBe('true\n');
    expect(lsReads).toEqual(['mermaid-vault-trust']);
    expect(configReads).toEqual([]);
  });

  it('reads an unset trust flag as null, the guarded state', async () => {
    const { app } = makeApp();
    const api = makeApi(app);

    const file = await api.getFile('obsidian://config/mermaid-vault-trust');
    expect((file as { content: string }).content).toBe('null\n');
  });

  it('blocks a trust write with the config gate off: zero saves', async () => {
    const { app, lsCalls, workspaceEvents } = makeApp({ localStorage: { 'mermaid-vault-trust': true } });
    const api = makeApi(app);

    await expectCode(api.updateFile('obsidian://config/mermaid-vault-trust', 'false'), 'CONFIG_WRITE_DISABLED');
    expect(lsCalls).toEqual([]);
    expect(workspaceEvents).toEqual([]);
  });

  it('applies a valid trust write through saveLocalStorage and re-renders', async () => {
    const { app, lsCalls, workspaceEvents } = makeApp({ localStorage: { 'mermaid-vault-trust': true } });
    const api = makeApi(app, { allowConfigEditing: true });

    await api.updateFile('obsidian://config/mermaid-vault-trust', 'false');
    expect(lsCalls).toEqual([{ key: 'mermaid-vault-trust', value: false }]);
    expect(workspaceEvents).toEqual(['post-processor-change']);
  });

  it('refuses invalid JSON before saveLocalStorage runs, with the toggle on', async () => {
    const { app, lsCalls } = makeApp();
    const api = makeApi(app, { allowConfigEditing: true });

    await expectCode(api.updateFile('obsidian://config/mermaid-vault-trust', 'truthy'), 'INVALID_CONFIG_JSON');
    expect(lsCalls).toEqual([]);
  });
});

describe('enabledCssSnippets writes apply live through the app toggle', () => {
  it('an added id routes through the app handler: no plain setConfig', async () => {
    const { app, configCalls, toggleCalls } = makeApp({
      config: { enabledCssSnippets: ['theme'] }
      , withCustomCss: true
    });
    const api = makeApi(app, { allowConfigEditing: true });

    await api.updateFile('obsidian://config/enabledCssSnippets', '[\n  "theme",\n  "other"\n]\n');
    expect(toggleCalls).toEqual([{ id: 'other', enabled: true }]);
    expect(configCalls).toEqual([]);
  });

  it('a removed id disables through the app handler', async () => {
    const { app, toggleCalls } = makeApp({
      config: { enabledCssSnippets: ['theme', 'other'] }
      , withCustomCss: true
    });
    const api = makeApi(app, { allowConfigEditing: true });

    await api.updateFile('obsidian://config/enabledCssSnippets', '[\n  "theme"\n]\n');
    expect(toggleCalls).toEqual([{ id: 'other', enabled: false }]);
  });

  it('a membership-equal write calls nothing', async () => {
    const { app, configCalls, toggleCalls } = makeApp({
      config: { enabledCssSnippets: ['theme'] }
      , withCustomCss: true
    });
    const api = makeApi(app, { allowConfigEditing: true });

    await api.updateFile('obsidian://config/enabledCssSnippets', '[\n  "theme"\n]\n');
    expect(toggleCalls).toEqual([]);
    expect(configCalls).toEqual([]);
  });

  it('falls back to a plain setConfig when the app handler is absent', async () => {
    const { app, configCalls, toggleCalls } = makeApp({
      config: { enabledCssSnippets: ['theme'] }
    });
    const api = makeApi(app, { allowConfigEditing: true });

    await api.updateFile('obsidian://config/enabledCssSnippets', '[\n  "theme",\n  "other"\n]\n');
    expect(toggleCalls).toEqual([]);
    expect(configCalls).toEqual([
      { key: 'enabledCssSnippets', value: ['theme', 'other'] }
    ]);
  });

  it('falls back to a plain setConfig for a non-array write', async () => {
    const { app, configCalls, toggleCalls } = makeApp({ withCustomCss: true });
    const api = makeApi(app, { allowConfigEditing: true });

    await api.updateFile('obsidian://config/enabledCssSnippets', 'null');
    expect(toggleCalls).toEqual([]);
    expect(configCalls).toEqual([
      { key: 'enabledCssSnippets', value: null }
    ]);
  });

  it('refuses a list with non-string or duplicate ids before any call runs', async () => {
    const { app, configCalls, toggleCalls } = makeApp({ withCustomCss: true });
    const api = makeApi(app, { allowConfigEditing: true });

    await expectCode(api.updateFile('obsidian://config/enabledCssSnippets', '[\n  "theme",\n  42\n]\n'), 'INVALID_SNIPPET_LIST');
    await expectCode(api.updateFile('obsidian://config/enabledCssSnippets', '[\n  "theme",\n  "theme"\n]\n'), 'INVALID_SNIPPET_LIST');
    expect(toggleCalls).toEqual([]);
    expect(configCalls).toEqual([]);
  });

  it('still refuses invalid JSON before any call runs', async () => {
    const { app, configCalls, toggleCalls } = makeApp({ withCustomCss: true });
    const api = makeApi(app, { allowConfigEditing: true });

    await expectCode(api.updateFile('obsidian://config/enabledCssSnippets', '[ Theme ]'), 'INVALID_CONFIG_JSON');
    expect(toggleCalls).toEqual([]);
    expect(configCalls).toEqual([]);
  });
});

describe('folder-scoped tokens and the managed namespaces', () => {
  it('a folder-scoped session cannot read or write either namespace', async () => {
    const { app, adapterOps, configCalls } = makeApp({
      snippets: { 'theme.css': 'body {}' }
      , config: { cssTheme: 'Minimal' }
    });
    const scope = new FolderScopedIgnoreManager(app, undefined, 'Projects');
    const api = makeApi(app, { allowSnippetEditing: true, allowConfigEditing: true }, scope);

    await expectCode(api.getFile('obsidian://snippets/theme.css'), 'PATH_BLOCKED');
    await expectCode(api.updateFile('obsidian://snippets/theme.css', 'x'), 'PATH_BLOCKED');
    await expectCode(api.listFiles('obsidian://snippets/'), 'PATH_BLOCKED');
    await expectCode(api.getFile('obsidian://config/cssTheme'), 'PATH_BLOCKED');
    await expectCode(api.updateFile('obsidian://config/cssTheme', '"x"'), 'PATH_BLOCKED');

    expect(adapterOps).toEqual([]);
    expect(configCalls).toEqual([]);
  });
});
