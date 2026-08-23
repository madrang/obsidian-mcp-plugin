import { App, TFile, TFolder } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { SemanticRouter } from '../src/semantic/router';

// view.folder glob filtering. The "view.glob" TODO shipped as an optional
// `pattern` parameter on the folder action, not a new action. These tests
// pin the filter semantics (matchBase for slash-free patterns, globstar
// for `**`, segment-local `*`), filter-before-pagination, and the router
// wiring that routes a pattern call onto the paginated path.

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop()!;
  f.extension = path.split('.').pop()!;
  return f;
}

function makeFolder(path: string, children: (TFile | TFolder)[]): TFolder {
  const folder = new TFolder();
  folder.path = path;
  folder.name = path.split('/').pop() || path;
  folder.children = children;
  return folder;
}

// Vault layout used by every case:
//   docs/
//     readme.md
//     a/ one.md, two.md, logo.png
//     b/ three.md, icon.svg
//     c/ sub/ four.md
function buildApi(): ObsidianAPI {
  const one = makeFile('docs/a/one.md');
  const two = makeFile('docs/a/two.md');
  const logo = makeFile('docs/a/logo.png');
  const three = makeFile('docs/b/three.md');
  const icon = makeFile('docs/b/icon.svg');
  const four = makeFile('docs/c/sub/four.md');
  const readme = makeFile('docs/readme.md');

  const a = makeFolder('docs/a', [one, two, logo]);
  const b = makeFolder('docs/b', [three, icon]);
  const sub = makeFolder('docs/c/sub', [four]);
  const c = makeFolder('docs/c', [sub]);
  const docs = makeFolder('docs', [readme, a, b, c]);

  const all = [docs, a, b, c, sub, readme, one, two, logo, three, icon, four];
  const lookup = new Map(all.map(f => [f.path, f]));

  const mockApp = new App();
  mockApp.vault.getAbstractFileByPath = (path: string) => lookup.get(path) ?? null;
  mockApp.vault.getAllLoadedFiles = () => all;
  mockApp.vault.adapter = { basePath: '/mock' } as any;

  return new ObsidianAPI(mockApp);
}

describe('ObsidianAPI.listFilesPaginated — pattern filter', () => {
  it('a slash-free glob matches the file name at any depth (*.md)', async () => {
    const api = buildApi();
    const result = await api.listFilesPaginated('docs', 1, 50, true, '*.md');
    expect(result.files.map(f => f.path)).toEqual([
      'docs/a/one.md',
      'docs/a/two.md',
      'docs/b/three.md',
      'docs/c/sub/four.md',
      'docs/readme.md',
    ]);
    expect(result.totalFiles).toBe(5);
    expect(result.pattern).toBe('*.md');
  });

  it('a globstar crosses folders (**/*.png)', async () => {
    const api = buildApi();
    const result = await api.listFilesPaginated('docs', 1, 50, true, '**/*.png');
    expect(result.files.map(f => f.path)).toEqual(['docs/a/logo.png']);
  });

  it('a single star stays in one folder (docs/*)', async () => {
    const api = buildApi();
    // Root, level-only listing: the pattern keeps direct children of docs
    // (folders and the top-level file) and drops everything nested below.
    const result = await api.listFilesPaginated(undefined, 1, 50, false, 'docs/*');
    expect(result.files.map(f => f.path).sort()).toEqual(['docs/a', 'docs/b', 'docs/c', 'docs/readme.md']);
  });

  it('filters before pagination, so pages slice the filtered set', async () => {
    const api = buildApi();
    const page1 = await api.listFilesPaginated('docs', 1, 2, true, '*.md');
    expect(page1.totalFiles).toBe(5);
    expect(page1.totalPages).toBe(3);

    const collected: string[] = [];
    for (let page = 1; page <= page1.totalPages; page++) {
      const slice = await api.listFilesPaginated('docs', page, 2, true, '*.md');
      collected.push(...slice.files.map(f => f.path));
    }
    expect(collected).toEqual([
      'docs/a/one.md',
      'docs/a/two.md',
      'docs/b/three.md',
      'docs/c/sub/four.md',
      'docs/readme.md',
    ]);
  });

  it('a glob that matches nothing returns an empty, pattern-echoed page', async () => {
    const api = buildApi();
    const result = await api.listFilesPaginated('docs', 1, 20, true, '*.xyz');
    expect(result.files).toEqual([]);
    expect(result.totalFiles).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.pattern).toBe('*.xyz');
  });

  it('matching is case-sensitive', async () => {
    const api = buildApi();
    const result = await api.listFilesPaginated('docs', 1, 50, true, '*.MD');
    expect(result.files).toEqual([]);
  });

  it('no pattern leaves the response shape unchanged', async () => {
    const api = buildApi();
    const result = await api.listFilesPaginated('docs', 1, 50, true);
    expect(result.pattern).toBeUndefined();
    expect(result.totalFiles).toBe(7);
  });
});

describe('view.folder router wiring — pattern param', () => {
  class RecordingAPI extends ObsidianAPI {
    lastPaginatedCall: unknown[] | undefined;
    listFilesCalled = false;

    constructor() {
      super({} as App);
    }

    async listFiles(): Promise<string[]> {
      this.listFilesCalled = true;
      return ['docs/readme.md'];
    }

    async listFilesPaginated(...args: unknown[]): Promise<any> {
      this.lastPaginatedCall = args;
      return { files: [], page: 1, pageSize: 20, totalFiles: 0, totalPages: 0 };
    }
  }

  it('a pattern routes onto the paginated path and reaches the API', async () => {
    const api = new RecordingAPI();
    const router = new SemanticRouter(api);
    await router.route({
      operation: 'view',
      action: 'folder',
      params: { pattern: '*.md' },
    });
    expect(api.lastPaginatedCall).toEqual([undefined, 1, 20, false, '*.md']);
    expect(api.listFilesCalled).toBe(false);
  });

  it('a pattern keeps caller-supplied page and pageSize', async () => {
    const api = new RecordingAPI();
    const router = new SemanticRouter(api);
    await router.route({
      operation: 'view',
      action: 'folder',
      params: { path: 'docs', pattern: '*.md', page: 2, pageSize: 5 },
    });
    expect(api.lastPaginatedCall).toEqual(['docs', 2, 5, true, '*.md']);
  });

  it('a blank pattern behaves as absent and keeps the legacy path', async () => {
    const api = new RecordingAPI();
    const router = new SemanticRouter(api);
    await router.route({
      operation: 'view',
      action: 'folder',
      params: { pattern: '   ' },
    });
    expect(api.listFilesCalled).toBe(true);
    expect(api.lastPaginatedCall).toBeUndefined();
  });

  it('path "/" maps to the vault root with the pattern intact', async () => {
    const api = new RecordingAPI();
    const router = new SemanticRouter(api);
    await router.route({
      operation: 'view',
      action: 'folder',
      params: { path: '/', pattern: '*.png' },
    });
    expect(api.lastPaginatedCall).toEqual([undefined, 1, 20, false, '*.png']);
  });
});
