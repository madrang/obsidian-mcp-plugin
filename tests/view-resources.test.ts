/**
 * Resource URIs through the view tool: read, lines, and window serve
 * obsidian://resources/<name> content without touching the vault, and
 * folder walks the namespace tree. This is the access path for clients
 * that cannot use the MCP resources/read request.
 */
import { App } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { VaultRouter } from '../src/tools/router';
import { createResourceService, RESOURCES_URI_PREFIX } from '../src/resources/registry';
import { ResourceDeps } from '../src/resources/types';

class RecordingAPI extends ObsidianAPI {
  readonly getFileCalls: string[] = [];

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<never> {
    this.getFileCalls.push(path);
    throw new Error(`unexpected vault getFile: ${path}`);
  }
}

function makeDeps(): ResourceDeps {
  const files = [{ path: 'a.md' }];
  const app = {
    vault: {
      getName: () => 'TestVault'
      , adapter: { basePath: '/test/vault' }
      , getAllLoadedFiles: () => files
      , getMarkdownFiles: () => files
    }
    , workspace: { getActiveFile: () => null }
  } as unknown as App;
  return {
    obsidianAPI: { getApp: () => app } as unknown as ObsidianAPI
    , sessionId: 'router-session'
    , sessionManager: {
      getAllSessions: () => []
      , getStats: () => ({ activeSessions: 1, maxSessions: 16, oldestSessionAge: 0, newestSessionAge: 0, totalRequests: 0 })
    } as never
    , serverPoolStats: { activeServers: 1, maxServers: 4, utilization: '25%', totalRequests: 0 }
    , sessionPolicy: { sessionTimeoutLabel: 'never', sessionsPerTokenLimit: 16, maxConcurrentConnections: 4 }
  };
}

function setup(opts: { withResources?: boolean } = {}) {
  const api = new RecordingAPI();
  const router = new VaultRouter(
    api
    , undefined
    , opts.withResources === false ? undefined : createResourceService(makeDeps())
  );
  return { api, router };
}

describe('view actions on resource URIs', () => {
  it('read serves the resource and never probes the vault', async () => {
    const { api, router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: `${RESOURCES_URI_PREFIX}infos/vault` }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { path: string; content: string };
    expect(result.path).toBe(`${RESOURCES_URI_PREFIX}infos/vault`);
    expect(JSON.parse(result.content).vault.name).toBe('TestVault');
    expect(api.getFileCalls).toEqual([]);
  });

  it('read serves a tool reference page as markdown', async () => {
    const { router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: `${RESOURCES_URI_PREFIX}view` }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { path: string; content: string };
    expect(result.content.startsWith('# view')).toBe(true);
    expect(result.content).toContain('## Actions');
  });

  it('read of a short-form URI probes the vault, not the resources: the canonical form is the only address', async () => {
    const { api, router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: 'obsidian://vault-info' }
    });

    expect(response.error).toBeDefined();
    expect(api.getFileCalls).toEqual(['obsidian://vault-info']);
  });

  it('lines slices the resource text with exact range addressing', async () => {
    const { api, router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'lines'
      , params: { path: `${RESOURCES_URI_PREFIX}infos/vault`, startLine: 1, endLine: 3 }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as {
      path: string; lines: string[]; startLine: number; endLine: number; totalLines: number;
    };
    expect(result.path).toBe(`${RESOURCES_URI_PREFIX}infos/vault`);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toBe('{');
    expect(api.getFileCalls).toEqual([]);
  });

  it('lines reports a stale address past the end of the resource text', async () => {
    const { router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'lines'
      , params: { path: `${RESOURCES_URI_PREFIX}infos/vault`, startLine: 100000, endLine: 100001 }
    });

    expect(response.error).toBeDefined();
    expect((response.error as { message?: string }).message).toContain('past the end');
  });

  it('window centers on a line of the resource text', async () => {
    const { api, router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'window'
      , params: { path: `${RESOURCES_URI_PREFIX}infos/vault`, lineNumber: 2, windowSize: 4 }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { path: string; lines: string[]; centerLine: number };
    expect(result.path).toBe(`${RESOURCES_URI_PREFIX}infos/vault`);
    expect(result.centerLine).toBe(2);
    expect(api.getFileCalls).toEqual([]);
  });

  it('read of an unregistered resource fails with UNKNOWN_RESOURCE and no vault probe', async () => {
    const { api, router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: 'obsidian://resources/nope' }
    });

    expect(response.error).toBeDefined();
    expect((response.error as { code?: string }).code).toBe('UNKNOWN_RESOURCE');
    expect(api.getFileCalls).toEqual([]);
  });

  it('fails clearly when the router carries no resource service', async () => {
    const { router } = setup({ withResources: false });
    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: `${RESOURCES_URI_PREFIX}infos/vault` }
    });

    expect(response.error).toBeDefined();
    expect((response.error as { message?: string }).message).toContain('not wired');
  });
});

describe('view.folder walks the resources tree', () => {
  it('the root lists the tool pages and the infos folder', async () => {
    const { api, router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'folder'
      , params: { path: RESOURCES_URI_PREFIX }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as {
      directory: string
      , files: Array<{ path: string; name: string; isFolder: boolean }>
      , totalFiles: number
      , totalFolders: number
    };
    expect(result.directory).toBe(RESOURCES_URI_PREFIX);
    const byPath = new Map(result.files.map(f => [f.path, f]));
    expect(byPath.get(`${RESOURCES_URI_PREFIX}view`)?.isFolder).toBe(false);
    expect(byPath.get(`${RESOURCES_URI_PREFIX}infos`)?.isFolder).toBe(true);
    expect(byPath.get(`${RESOURCES_URI_PREFIX}syntax`)?.isFolder).toBe(true);
    expect(result.files.map(f => f.path)).not.toContain(`${RESOURCES_URI_PREFIX}infos/vault`);
    expect(result.files.map(f => f.path)).not.toContain(`${RESOURCES_URI_PREFIX}syntax/markdown`);
    expect(result.totalFiles).toBe(6);
    expect(result.totalFolders).toBe(2);
    expect(api.getFileCalls).toEqual([]);
  });

  it('the syntax folder lists the ten syntax pages', async () => {
    const { router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'folder'
      , params: { path: `${RESOURCES_URI_PREFIX}syntax/` }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { directory: string; files: Array<{ path: string; isFolder: boolean }> };
    expect(result.directory).toBe(`${RESOURCES_URI_PREFIX}syntax/`);
    expect(result.files).toHaveLength(10);
    expect(result.files.every(f => f.isFolder === false)).toBe(true);
    expect(result.files.map(f => f.path)).toContain(`${RESOURCES_URI_PREFIX}syntax/internal-links`);
  });

  it('the infos folder lists the info resources', async () => {
    const { router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'folder'
      , params: { path: `${RESOURCES_URI_PREFIX}infos/` }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { directory: string; files: Array<{ path: string; isFolder: boolean }> };
    expect(result.directory).toBe(`${RESOURCES_URI_PREFIX}infos/`);
    expect(result.files.map(f => f.path)).toEqual([
      `${RESOURCES_URI_PREFIX}infos/session`
      , `${RESOURCES_URI_PREFIX}infos/vault`
    ]);
    expect(result.files.every(f => f.isFolder === false)).toBe(true);
  });

  it('a nonexistent resources folder path fails with UNKNOWN_RESOURCE', async () => {
    const { router } = setup();
    const response = await router.route({
      operation: 'view'
      , action: 'folder'
      , params: { path: `${RESOURCES_URI_PREFIX}nope/` }
    });

    expect(response.error).toBeDefined();
    expect((response.error as { code?: string }).code).toBe('UNKNOWN_RESOURCE');
  });
});
