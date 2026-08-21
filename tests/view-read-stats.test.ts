/**
 * Stats ride on complete reads only. The mtime and content hash feed the
 * edit tool's ifUnmodifiedSince / ifHash preconditions, so they must not be
 * obtainable without the content: getFileStat is internal (not a tool
 * action), and partial reads — pages, fragments — carry neither value. Only
 * the branch that returns the complete file exposes them.
 */
import { readFileWithFragments } from '../src/utils/file-reader';
import { contentHash } from '../src/utils/content-hash';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { UniversalFragmentRetriever } from '../src/indexing/fragment-retriever';
import { App, TFile } from 'obsidian';

class StatMockAPI extends ObsidianAPI {
  files = new Map<string, { content: string; mtime: number }>();

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<any> {
    const entry = this.files.get(path);
    if (entry === undefined) throw new Error(`not found: ${path}`);
    return { path, content: entry.content, mtime: entry.mtime, tags: [], frontmatter: {} };
  }
}

const fr = () => new UniversalFragmentRetriever();

describe('read stats ride only on complete reads', () => {
  test('small file read returns mtime and the content hash', async () => {
    const api = new StatMockAPI();
    api.files.set('a.md', { content: 'hello\nworld', mtime: 1724000000000 });
    const r: any = await readFileWithFragments(api, fr(), { path: 'a.md' });

    expect(r.mtime).toBe(1724000000000);
    expect(r.hash).toBe(contentHash('hello\nworld'));
  });

  const big = Array.from({ length: 4000 }, (_, i) => `line ${i + 1} ${'x'.repeat(20)}`).join('\n');

  test('paged read of a large file carries neither mtime nor hash', async () => {
    const api = new StatMockAPI();
    api.files.set('big.md', { content: big, mtime: 1724000000000 });
    const r: any = await readFileWithFragments(api, fr(), { path: 'big.md' });

    expect(r.pagination.paginated).toBe(true);
    expect(r.mtime).toBeUndefined();
    expect(r.hash).toBeUndefined();
    // The values must not slip into metadata either.
    expect(JSON.stringify(r.metadata)).not.toContain('1724000000000');
  });

  test('fragment read carries neither mtime nor hash', async () => {
    const api = new StatMockAPI();
    api.files.set('a.md', { content: 'hello\nworld', mtime: 1724000000000 });
    const r: any = await readFileWithFragments(api, fr(), { path: 'a.md', query: 'hello' });

    expect(r.fragmentMetadata).toBeDefined();
    expect(r.mtime).toBeUndefined();
    expect(r.hash).toBeUndefined();
  });

  test('returnFullFile=true on a large file is a complete read, so both ride along', async () => {
    const api = new StatMockAPI();
    api.files.set('big.md', { content: big, mtime: 1724000000000 });
    const r: any = await readFileWithFragments(api, fr(), { path: 'big.md', returnFullFile: true });

    expect(r.mtime).toBe(1724000000000);
    expect(r.hash).toBe(contentHash(big));
  });
});

describe('ObsidianAPI.getFileStat (internal primitive)', () => {
  function makeStatApp(files: Record<string, { content: string; mtime: number }>): App {
    const app = new App();
    const asTFile = (path: string): TFile => {
      const f = new TFile();
      f.path = path;
      f.name = path.split('/').pop()!;
      f.extension = path.split('.').pop()!;
      (f as any).stat = {
        ctime: 500,
        mtime: files[path].mtime,
        size: files[path].content.length,
      };
      return f;
    };
    (app.vault as any).getAbstractFileByPath = (path: string) =>
      files[path] ? asTFile(path) : null;
    (app.vault as any).cachedRead = async (f: TFile) => files[f.path].content;
    return app;
  }

  test('reports exists false for a missing path', async () => {
    const api = new ObsidianAPI(makeStatApp({}));
    const stat = await api.getFileStat('ghost.md');
    expect(stat).toEqual({ path: 'ghost.md', exists: false });
  });

  test('reports mtime, lineCount, and the content hash for a text file', async () => {
    const api = new ObsidianAPI(makeStatApp({ 'a.md': { content: 'one\ntwo\nthree', mtime: 1000 } }));
    const stat = await api.getFileStat('a.md');
    expect(stat).toEqual({
      path: 'a.md',
      exists: true,
      size: 13,
      mtime: 1000,
      ctime: 500,
      lineCount: 3,
      hash: contentHash('one\ntwo\nthree'),
    });
  });
});
