/**
 * ADR-110 and .mcpignore containment on view.folder. The listing has two
 * channels with different filtering: the bare call routes through
 * listFiles, which filters every path through the ignore manager. A call
 * with page, pageSize, limit, or pattern routes through
 * listFilesPaginated, which validates the requested directory only and
 * returns children with no exclusion filtering. A scoped token holds its
 * directory gate on both channels; the ignore-file boundary does not hold
 * on the paginated channel. Assertions are on returned paths: a leak is a
 * path list, not an error string.
 */
import { App, TAbstractFile, TFile, TFolder } from 'obsidian';

jest.mock('obsidian');

import { VaultRouter } from '../../src/tools/router';
import { SecureObsidianAPI } from '../../src/security/secure-obsidian-api';
import { FolderScopedIgnoreManager } from '../../src/security/token-scope';
import { MCPIgnoreManager } from '../../src/security/mcp-ignore-manager';
import { BASELINE_SECURITY_SETTINGS } from '../../src/security/baseline-settings';
import { TokenScope } from '../../src/security/http-auth';

function mkFile(p: string): TFile {
  const f = new TFile();
  const w = f as unknown as { path: string; extension: string; name: string; stat: unknown };
  w.path = p;
  w.extension = 'md';
  w.name = p.split('/').pop()!;
  w.stat = { ctime: 1, mtime: 1, size: 10 };
  return f;
}

function mkFolder(p: string, children: TAbstractFile[]): TFolder {
  const f = new TFolder();
  (f as unknown as { path: string; name: string }).path = p;
  (f as unknown as { path: string; name: string }).name = p.split('/').pop()!;
  (f as unknown as { children: TAbstractFile[] }).children = children;
  return f;
}

/**
 * The tree. Secret/ and Projects/Hidden/ carry the .mcpignore patterns.
 * ProjectsX shares the Projects prefix: a boundary sibling for the scope
 * checks.
 */
function makeApp(ignoreContent?: string): App {
  const deep = mkFolder('Projects/Sub/Deep', [mkFile('Projects/Sub/Deep/deep-in-scope.md')]);
  const sub = mkFolder('Projects/Sub', [mkFile('Projects/Sub/in-scope.md'), deep]);
  const hidden = mkFolder('Projects/Hidden', [mkFile('Projects/Hidden/private.md')]);
  const projects = mkFolder('Projects', [sub, hidden]);
  const projectsX = mkFolder('ProjectsX', [mkFile('ProjectsX/evil-sibling.md')]);
  const secret = mkFolder('Secret', [mkFile('Secret/top-secret.md')]);
  const notes = mkFolder('Notes', [mkFile('Notes/b.md')]);

  const folders = new Map<string, TFolder>([
    ['Projects', projects]
    , ['Projects/Sub', sub]
    , ['Projects/Sub/Deep', deep]
    , ['Projects/Hidden', hidden]
    , ['ProjectsX', projectsX]
    , ['Secret', secret]
    , ['Notes', notes]
  ]);

  const files = [
    'Projects/Sub/in-scope.md'
    , 'Projects/Sub/Deep/deep-in-scope.md'
    , 'Projects/Hidden/private.md'
    , 'ProjectsX/evil-sibling.md'
    , 'Secret/top-secret.md'
    , 'Notes/b.md'
    , 'secret.md'
  ].map(mkFile);

  const all: TAbstractFile[] = [...folders.values(), ...files];

  return {
    vault: {
      adapter: {
        basePath: '/test/vault'
        , read: async (p: string) => (p === '.mcpignore' ? (ignoreContent ?? '') : '')
        , stat: async () => ({ mtime: 1, ctime: 1, size: 1, type: 'file' as const })
      }
      , getAbstractFileByPath: (p: string) => folders.get(p) ?? null
      , getAllLoadedFiles: () => all
      , getMarkdownFiles: () => files
      , read: async () => 'body\n'
      , cachedRead: async () => 'body\n'
    }
    , metadataCache: { getFileCache: () => ({}), resolvedLinks: {} }
    , workspace: { getActiveFile: () => null }
  } as unknown as App;
}

/** The .mcpignore patterns: Secret/ and Projects/Hidden/ are excluded. */
const IGNORE_PATTERNS = ['Secret/', 'Projects/Hidden/'].join('\n');

async function makeBaseManager(app: App): Promise<MCPIgnoreManager> {
  const base = new MCPIgnoreManager(app);
  base.setEnabled(true);
  await base.loadIgnoreFile();
  return base;
}

async function scopedRouter(scope: TokenScope, ignoreContent?: string): Promise<VaultRouter> {
  const app = makeApp(ignoreContent);
  const base = ignoreContent !== undefined ? await makeBaseManager(app) : undefined;
  const scoped = new FolderScopedIgnoreManager(app, base, [scope]);
  const pluginRef = { settings: { readOnlyMode: false }, ignoreManager: scoped };
  const api = new SecureObsidianAPI(app, undefined, pluginRef as never, BASELINE_SECURITY_SETTINGS);
  return new VaultRouter(api);
}

async function unscopedRouter(ignoreContent: string): Promise<VaultRouter> {
  const app = makeApp(ignoreContent);
  const base = await makeBaseManager(app);
  const pluginRef = { settings: { readOnlyMode: false }, ignoreManager: base };
  const api = new SecureObsidianAPI(app, undefined, pluginRef as never, BASELINE_SECURITY_SETTINGS);
  return new VaultRouter(api);
}

const IGNORED_MARKERS = [
  'Secret', 'Secret/top-secret.md'
  , 'Projects/Hidden', 'Projects/Hidden/private.md'
];

function leakedPaths(paths: string[]): string[] {
  return paths.filter(p => IGNORED_MARKERS.includes(p));
}

function leakedFrom(paths: string[], markers: string[]): string[] {
  return paths.filter(p => markers.includes(p));
}

/** Page through a paginated listing the way an agent does, until hasMore
 * turns false. The page budget windows few items per call, so a leak hides
 * on page 1 and surfaces across the walk. */
async function collectAllPages(router: VaultRouter, params: Record<string, unknown>): Promise<string[]> {
  const paths: string[] = [];
  for (let page = 1; page <= 50; page++) {
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { ...params, page },
    });
    if (response.error) throw new Error(`page ${page}: ${response.error.message}`);
    paths.push(...response.result.files.map((f: { path: string }) => f.path));
    if (!response.result.hasMore) return paths;
  }
  throw new Error('pagination did not terminate within 50 pages');
}

describe('view.folder token-scope directory gate (ADR-110)', () => {
  test('the bare root listing is refused for a scoped token', async () => {
    const router = await scopedRouter({ folder: 'Projects/Sub' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: '/' },
    });
    expect(response.error?.code).toBe('PATH_BLOCKED');
  });

  test('the paginated root listing is refused for a scoped token', async () => {
    const router = await scopedRouter({ folder: 'Projects/Sub' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: '/', page: 1, pageSize: 50 },
    });
    expect(response.error?.code).toBe('PATH_BLOCKED');
  });

  test('a paginated listing of the scope parent is refused', async () => {
    const router = await scopedRouter({ folder: 'Projects/Sub' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'Projects', page: 1 },
    });
    expect(response.error?.code).toBe('PATH_BLOCKED');
  });

  test('a paginated listing of an unrelated folder is refused', async () => {
    const router = await scopedRouter({ folder: 'Projects/Sub' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'Secret', page: 1 },
    });
    expect(response.error?.code).toBe('PATH_BLOCKED');
  });

  test('the paginated listing of the scope folder returns in-scope files only', async () => {
    const router = await scopedRouter({ folder: 'Projects/Sub' });
    const paths = await collectAllPages(router, { path: 'Projects/Sub', pageSize: 50 });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every(p => p === 'Projects/Sub' || p.startsWith('Projects/Sub/'))).toBe(true);
    expect(paths).toContain('Projects/Sub/in-scope.md');
  });
});

describe('view.folder ignore-file containment', () => {
  test('the bare listing of an in-scope folder drops ignored children', async () => {
    const router = await scopedRouter({ folder: 'Projects' }, IGNORE_PATTERNS);
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'Projects' },
    });
    expect(response.error).toBeUndefined();
    const paths: string[] = response.result;
    expect(paths).toContain('Projects/Sub/in-scope.md');
    expect(leakedPaths(paths)).toEqual([]);
  });

  test('the paginated listing of an in-scope folder drops ignored children', async () => {
    const router = await scopedRouter({ folder: 'Projects' }, IGNORE_PATTERNS);
    const paths = await collectAllPages(router, { path: 'Projects', pageSize: 50 });
    expect(paths).toContain('Projects/Sub/in-scope.md');
    expect(leakedPaths(paths)).toEqual([]);
  });

  test('a pattern listing of an in-scope folder drops ignored children', async () => {
    const router = await scopedRouter({ folder: 'Projects' }, IGNORE_PATTERNS);
    const paths = await collectAllPages(router, { path: 'Projects', pattern: '*.md' });
    expect(paths).toContain('Projects/Sub/in-scope.md');
    expect(leakedPaths(paths)).toEqual([]);
  });

  test('a paginated root listing on an unscoped session drops ignored folders and files', async () => {
    const router = await unscopedRouter(IGNORE_PATTERNS);
    const paths = await collectAllPages(router, { path: '/', pageSize: 100 });
    expect(paths).toContain('Projects');
    expect(paths).toContain('Notes');
    expect(leakedPaths(paths)).toEqual([]);
  });
});

/**
 * The nested-scope shape: the token holds /foo/shared only. Every other
 * folder under foo — the sibling foo/other, the prefix sibling foo/sharedX
 * — must stay invisible on every listing channel, and a traversal path
 * that starts inside the scope must not normalize into a sibling listing.
 */
const FOO_MARKERS = [
  'foo', 'foo/other', 'foo/other/other-doc.md'
  , 'foo/sharedX', 'foo/sharedX/boundary-doc.md'
  , 'bar', 'bar/bar-doc.md'
];

async function fooScopedRouter(scope: TokenScope): Promise<VaultRouter> {
  const inner = mkFolder('foo/shared/inner', [mkFile('foo/shared/inner/inner-doc.md')]);
  const shared = mkFolder('foo/shared', [mkFile('foo/shared/doc.md'), inner]);
  const other = mkFolder('foo/other', [mkFile('foo/other/other-doc.md')]);
  const sharedX = mkFolder('foo/sharedX', [mkFile('foo/sharedX/boundary-doc.md')]);
  const foo = mkFolder('foo', [shared, other, sharedX]);
  const bar = mkFolder('bar', [mkFile('bar/bar-doc.md')]);

  const folders = new Map<string, TFolder>([
    ['foo', foo]
    , ['foo/shared', shared]
    , ['foo/shared/inner', inner]
    , ['foo/other', other]
    , ['foo/sharedX', sharedX]
    , ['bar', bar]
  ]);
  const files = [
    'foo/shared/doc.md'
    , 'foo/shared/inner/inner-doc.md'
    , 'foo/other/other-doc.md'
    , 'foo/sharedX/boundary-doc.md'
    , 'bar/bar-doc.md'
  ].map(mkFile);
  const all: TAbstractFile[] = [...folders.values(), ...files];

  const app = {
    vault: {
      adapter: { basePath: '/test/vault' }
      , getAbstractFileByPath: (p: string) => folders.get(p) ?? null
      , getAllLoadedFiles: () => all
      , getMarkdownFiles: () => files
      , read: async () => 'body\n'
      , cachedRead: async () => 'body\n'
    }
    , metadataCache: { getFileCache: () => ({}), resolvedLinks: {} }
    , workspace: { getActiveFile: () => null }
  } as unknown as App;

  const scoped = new FolderScopedIgnoreManager(app, undefined, [scope]);
  const pluginRef = { settings: { readOnlyMode: false }, ignoreManager: scoped };
  const api = new SecureObsidianAPI(app, undefined, pluginRef as never, BASELINE_SECURITY_SETTINGS);
  return new VaultRouter(api);
}

describe('view.folder nested scope /foo/shared', () => {
  test('listing the parent foo is refused, bare and paginated', async () => {
    const router = await fooScopedRouter({ folder: '/foo/shared' });
    const bare: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'foo' },
    });
    expect(bare.error?.code).toBe('PATH_BLOCKED');
    const paged: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'foo', page: 1 },
    });
    expect(paged.error?.code).toBe('PATH_BLOCKED');
  });

  test('listing the parent with a leading slash is refused too', async () => {
    const router = await fooScopedRouter({ folder: '/foo/shared' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: '/foo', page: 1 },
    });
    expect(response.error).toBeDefined();
  });

  test('the root listing is refused', async () => {
    const router = await fooScopedRouter({ folder: '/foo/shared' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: '/', page: 1 },
    });
    expect(response.error?.code).toBe('PATH_BLOCKED');
  });

  test('listing the scope folder shows its subtree only', async () => {
    const router = await fooScopedRouter({ folder: '/foo/shared' });
    const paths = await collectAllPages(router, { path: 'foo/shared', pageSize: 50 });
    expect(paths).toContain('foo/shared/doc.md');
    expect(paths).toContain('foo/shared/inner/inner-doc.md');
    expect(leakedFrom(paths, FOO_MARKERS)).toEqual([]);
  });

  test('listing the prefix sibling foo/sharedX is refused', async () => {
    const router = await fooScopedRouter({ folder: '/foo/shared' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'foo/sharedX', page: 1 },
    });
    expect(response.error?.code).toBe('PATH_BLOCKED');
  });

  test('listing foo/other is refused with the trailing-slash scope spelling', async () => {
    const router = await fooScopedRouter({ folder: '/foo/shared/' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'foo/other', page: 1 },
    });
    expect(response.error?.code).toBe('PATH_BLOCKED');
  });

  test('a traversal path through the scope prefix never lists a sibling', async () => {
    const router = await fooScopedRouter({ folder: '/foo/shared' });
    const response: any = await router.route({
      operation: 'view', action: 'folder', params: { path: 'foo/shared/../other', page: 1 },
    });
    if (response.error) {
      // Refused (blocked or not found): no listing, no leak.
      expect(response.error).toBeDefined();
      return;
    }
    const paths: string[] = response.result.files.map((f: { path: string }) => f.path);
    expect(paths.every(p => p === 'foo/shared' || p.startsWith('foo/shared/'))).toBe(true);
    expect(leakedFrom(paths, FOO_MARKERS)).toEqual([]);
  });
});
