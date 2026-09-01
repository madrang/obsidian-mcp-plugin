/**
 * Managed namespaces through the router: snippet files and config keys
 * served by the normal view, edit, and files actions on their URIs
 * (ADR-113). The adapter and setConfig are recording mocks: write cases
 * assert on what landed.
 */
import { App } from 'obsidian';
import { SecureObsidianAPI } from '../src/security/secure-obsidian-api';
import { VaultRouter } from '../src/tools/router';
import { CONFIG_KEYS } from '../src/utils/app-config';

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
  op: 'write' | 'remove';
  path: string;
  content?: string;
}

function setup(opts: {
  snippets?: Record<string, string>;
  config?: Record<string, unknown>;
  localStorage?: Record<string, unknown>;
  settings?: { allowSnippetEditing?: boolean; allowConfigEditing?: boolean };
} = {}) {
  const adapterOps: AdapterOp[] = [];
  const configCalls: Array<{ key: string; value: unknown }> = [];
  const lsCalls: Array<{ key: string; value: unknown }> = [];
  const lsStore = new Map<string, unknown>(Object.entries(opts.localStorage ?? {}));
  const snippetFiles = new Map<string, string>(
    Object.entries(opts.snippets ?? {}).map(([name, content]) => [`.obsidian/snippets/${name}`, content])
  );
  const config = new Map<string, unknown>(Object.entries(opts.config ?? {}));

  const app = {
    vault: {
      configDir: '.obsidian'
      , adapter: {
        basePath: '/test/vault'
        , exists: async (p: string) => snippetFiles.has(p)
        , read: async (p: string) => snippetFiles.get(p) ?? (() => { throw new Error(`missing: ${p}`); })()
        , write: async (p: string, data: string) => {
          adapterOps.push({ op: 'write', path: p, content: data });
          snippetFiles.set(p, data);
        }
        , remove: async (p: string) => {
          adapterOps.push({ op: 'remove', path: p });
          snippetFiles.delete(p);
        }
        , list: async () => ({ files: [...snippetFiles.keys()], folders: [] })
        , mkdir: async () => {}
        , stat: async (p: string) => ({ type: 'file' as const, mtime: 1700000000000, size: (snippetFiles.get(p) ?? '').length, ctime: 1700000000000 })
      }
      , getName: () => 'TestVault'
      , getAbstractFileByPath: () => null
      , getAllLoadedFiles: () => []
      , getMarkdownFiles: () => []
      , getConfig: (key: string) => config.get(key)
      , setConfig: (key: string, value: unknown) => {
        configCalls.push({ key, value });
        config.set(key, value);
      }
    }
    , loadLocalStorage: (key: string) => lsStore.get(key)
    , saveLocalStorage: (key: string, value: unknown) => {
      lsCalls.push({ key, value });
      lsStore.set(key, value);
    }
    , workspace: { getActiveFile: () => null, trigger: () => {} }
  } as unknown as App;

  const api = new SecureObsidianAPI(app, undefined, { settings: opts.settings ?? {} } as never, PERMISSIVE);
  const router = new VaultRouter(api, app);
  return { app, api, router, adapterOps, configCalls, lsCalls, snippetFiles };
}

function errCode(response: { error?: { code?: string } }): string | undefined {
  return response.error?.code;
}

describe('snippet files through the normal tool actions', () => {
  it('view.read serves the snippet content on the URI', async () => {
    const { router } = setup({ snippets: { 'theme.css': 'body { color: red; }' } });
    const response = await router.route({
      operation: 'view', action: 'read', params: { path: 'obsidian://snippets/theme.css' }
    });

    expect(errCode(response)).toBeUndefined();
    expect(JSON.stringify(response.result)).toContain('color: red');
  });

  it('view.lines slices the snippet text', async () => {
    const { router } = setup({ snippets: { 'theme.css': 'a\nb\nc' } });
    const response = await router.route({
      operation: 'view', action: 'lines', params: { path: 'obsidian://snippets/theme.css', startLine: 2, endLine: 3 }
    });

    expect(errCode(response)).toBeUndefined();
    expect((response.result as { lines: string[] }).lines).toEqual(['b', 'c']);
  });

  it('edit.replace rewrites the snippet through the gate', async () => {
    const { router, adapterOps } = setup({
      snippets: { 'theme.css': 'body { color: red; }' }
      , settings: { allowSnippetEditing: true }
    });
    const response = await router.route({
      operation: 'edit', action: 'replace'
      , params: { path: 'obsidian://snippets/theme.css', oldText: 'color: red', newText: 'color: blue' }
    });

    expect(errCode(response)).toBeUndefined();
    expect(adapterOps).toEqual([
      { op: 'write', path: '.obsidian/snippets/theme.css', content: 'body { color: blue; }' }
    ]);
  });

  it('edit.replace on a snippet is refused with the gate off: zero writes', async () => {
    const { router, adapterOps } = setup({ snippets: { 'theme.css': 'body {}' } });
    const response = await router.route({
      operation: 'edit', action: 'replace'
      , params: { path: 'obsidian://snippets/theme.css', oldText: 'body', newText: 'html' }
    });

    expect(errCode(response)).toBe('SNIPPET_WRITE_DISABLED');
    expect(adapterOps).toEqual([]);
  });

  it('files.delete removes a disabled snippet and refuses an enabled one', async () => {
    const enabled = setup({
      snippets: { 'on.css': 'body {}' }
      , config: { enabledCssSnippets: ['on'] }
      , settings: { allowSnippetEditing: true }
    });
    const refused = await enabled.router.route({
      operation: 'files', action: 'delete', params: { path: 'obsidian://snippets/on.css' }
    });
    expect(errCode(refused)).toBe('SNIPPET_ENABLED');
    expect(enabled.adapterOps).toEqual([]);

    const disabled = setup({
      snippets: { 'off.css': 'body {}' }
      , config: { enabledCssSnippets: [] }
      , settings: { allowSnippetEditing: true }
    });
    const deleted = await disabled.router.route({
      operation: 'files', action: 'delete', params: { path: 'obsidian://snippets/off.css' }
    });
    expect(errCode(deleted)).toBeUndefined();
    expect(disabled.adapterOps).toEqual([
      { op: 'remove', path: '.obsidian/snippets/off.css' }
    ]);
  });

  it('files.create writes a new snippet through the gate', async () => {
    const { router, adapterOps } = setup({ settings: { allowSnippetEditing: true } });
    const response = await router.route({
      operation: 'files', action: 'create'
      , params: { path: 'obsidian://snippets/new.css', content: 'body { margin: 0; }' }
    });

    expect(errCode(response)).toBeUndefined();
    expect(adapterOps).toEqual([
      { op: 'write', path: '.obsidian/snippets/new.css', content: 'body { margin: 0; }' }
    ]);
  });
});

describe('namespace folder listings', () => {
  it('view.folder on the snippets root lists the snippet URIs', async () => {
    const { router } = setup({ snippets: { 'b.css': 'b', 'a.css': 'a', 'note.txt': 'not css' } });
    const response = await router.route({
      operation: 'view', action: 'folder', params: { path: 'obsidian://snippets/' }
    });

    expect(errCode(response)).toBeUndefined();
    const result = response.result as { directory: string; files: Array<{ path: string; name: string }>; totalFiles: number };
    expect(result.directory).toBe('obsidian://snippets/');
    expect(result.files.map((f) => f.path)).toEqual([
      'obsidian://snippets/a.css'
      , 'obsidian://snippets/b.css'
    ]);
    expect(result.totalFiles).toBe(2);
  });

  it('view.folder on the bare snippets root lists the same URIs', async () => {
    const { router } = setup({ snippets: { 'a.css': 'a' } });
    const response = await router.route({
      operation: 'view', action: 'folder', params: { path: 'obsidian://snippets' }
    });

    expect(errCode(response)).toBeUndefined();
    const result = response.result as { directory: string };
    expect(result.directory).toBe('obsidian://snippets/');
  });

  it('view.folder on a snippet file URI reports Directory not found', async () => {
    const { router } = setup({ snippets: { 'a.css': 'a' } });
    const response = await router.route({
      operation: 'view', action: 'folder', params: { path: 'obsidian://snippets/a.css' }
    });

    expect((response.error as { message?: string }).message).toContain('Directory not found');
  });

  it('view.folder on the config root lists the curated key catalog', async () => {
    const { router } = setup();
    const response = await router.route({
      operation: 'view', action: 'folder', params: { path: 'obsidian://config/' }
    });

    expect(errCode(response)).toBeUndefined();
    const result = response.result as { directory: string; files: Array<{ path: string; name: string }>; totalFiles: number };
    expect(result.directory).toBe('obsidian://config/');
    const names = result.files.map((f) => f.name);
    expect(names).toContain('cssTheme');
    expect(names).toContain('enabledCssSnippets');
    expect(result.totalFiles).toBe(names.length);
    expect(result.files.every((f) => f.path.startsWith('obsidian://config/'))).toBe(true);
  });

  it('view.folder on a config key URI reports Directory not found', async () => {
    const { router } = setup({ config: { cssTheme: 'Minimal' } });
    const response = await router.route({
      operation: 'view', action: 'folder', params: { path: 'obsidian://config/cssTheme' }
    });

    expect((response.error as { message?: string }).message).toContain('Directory not found');
  });

  it('the catalog documents every key with a type and a description', () => {
    const knownTypes = ['string', 'boolean', 'number', 'array', 'object'];
    for (const [key, info] of Object.entries(CONFIG_KEYS)) {
      expect(knownTypes).toContain(info.type);
      expect(info.description.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
    expect(CONFIG_KEYS['enabledCssSnippets'].type).toBe('array');
    expect(CONFIG_KEYS['baseFontSize'].type).toBe('number');
    expect(CONFIG_KEYS['cssTheme'].type).toBe('string');
  });

  it('the config folder listing includes the mapped localStorage keys', async () => {
    const { router } = setup();
    const response = await router.route({
      operation: 'view', action: 'folder', params: { path: 'obsidian://config/' }
    });

    expect(errCode(response)).toBeUndefined();
    const names = ((response.result as { files: Array<{ name: string }> }).files).map((f) => f.name);
    expect(names).toContain('mermaid-vault-trust');
  });

  it('a localStorage-backed key reads and writes like every other config key', async () => {
    const { router, lsCalls } = setup({
      localStorage: { 'mermaid-vault-trust': true }
      , settings: { allowConfigEditing: true }
    });

    const read = await router.route({
      operation: 'view', action: 'read', params: { path: 'obsidian://config/mermaid-vault-trust' }
    });
    expect(errCode(read)).toBeUndefined();
    expect(JSON.stringify(read.result)).toContain('true');

    const write = await router.route({
      operation: 'edit', action: 'replace'
      , params: { path: 'obsidian://config/mermaid-vault-trust', oldText: 'true', newText: 'false' }
    });
    expect(errCode(write)).toBeUndefined();
    expect(lsCalls).toEqual([{ key: 'mermaid-vault-trust', value: false }]);
  });
});

describe('config keys through the normal tool actions', () => {
  it('view.read serves the config value as JSON text', async () => {
    const { router } = setup({ config: { cssTheme: 'Minimal' } });
    const response = await router.route({
      operation: 'view', action: 'read', params: { path: 'obsidian://config/cssTheme' }
    });

    expect(errCode(response)).toBeUndefined();
    expect(JSON.stringify(response.result)).toContain('Minimal');
  });

  it('edit.replace on a config key applies through setConfig', async () => {
    const { router, configCalls } = setup({
      config: { enabledCssSnippets: ['theme'] }
      , settings: { allowConfigEditing: true }
    });
    const response = await router.route({
      operation: 'edit', action: 'replace'
      , params: {
        path: 'obsidian://config/enabledCssSnippets'
        , oldText: '[\n  "theme"\n]\n'
        , newText: '[\n  "theme",\n  "other"\n]\n'
      }
    });

    expect(errCode(response)).toBeUndefined();
    expect(configCalls).toEqual([
      { key: 'enabledCssSnippets', value: ['theme', 'other'] }
    ]);
  });

  it('files.create on an existing config key follows the overwrite rule, and on a new key is refused', async () => {
    const { router, configCalls } = setup({
      config: { cssTheme: 'Minimal' }
      , settings: { allowConfigEditing: true, allowSnippetEditing: true }
    });

    // Existing key: the create probe sees it, so the overwrite rule speaks
    // first, exactly as for a vault file.
    const noOverwrite = await router.route({
      operation: 'files', action: 'create', params: { path: 'obsidian://config/cssTheme', content: '"x"' }
    });
    expect(errCode(noOverwrite)).toBeDefined();
    expect((noOverwrite.error as { message?: string }).message).toContain('overwrite');
    expect(configCalls).toEqual([]);

    // New key: creating config keys is not supported.
    const newKey = await router.route({
      operation: 'files', action: 'create', params: { path: 'obsidian://config/brandNewKey', content: '"x"' }
    });
    expect(errCode(newKey)).toBe('CONFIG_ACTION_UNSUPPORTED');
    expect(configCalls).toEqual([]);
  });

  it('a config write with the gate off reports CONFIG_WRITE_DISABLED', async () => {
    const { router, configCalls } = setup({ config: { cssTheme: 'Minimal' } });
    const response = await router.route({
      operation: 'edit', action: 'replace'
      , params: { path: 'obsidian://config/cssTheme', oldText: '"Minimal"', newText: '"Other"' }
    });

    expect(errCode(response)).toBe('CONFIG_WRITE_DISABLED');
    expect(configCalls).toEqual([]);
  });
});
