/**
 * Write preconditions on edit actions (ifUnmodifiedSince / ifHash). The
 * values are the stats a complete view.read returns. A mismatch refuses the
 * edit with the stable PRECONDITION_FAILED code before any mutation.
 *
 * The assertions are on recorded writes, not on error strings: a friendly
 * refusal means nothing if the write already landed (the same pattern as
 * the #210 dispatch-guard tests).
 */
import { SemanticRouter } from '../src/semantic/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { contentHash } from '../src/utils/content-hash';
import { FileStatResponse } from '../src/types/obsidian';
import { App, TFile } from 'obsidian';

type Mutation = { kind: string; path: string; content?: string };

class PreconditionAPI extends ObsidianAPI {
  readonly mutations: Mutation[] = [];
  private files = new Map<string, { content: string; mtime: number }>([
    ['note.md', { content: 'alpha\nbeta', mtime: 1000 }],
  ]);
  private nextMtime = 1000;

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<any> {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`File not found: ${path}`);
    return { path, content: entry.content, mtime: entry.mtime, tags: [], frontmatter: {} };
  }

  async getFileStat(path: string): Promise<FileStatResponse> {
    const entry = this.files.get(path);
    if (!entry) return { path, exists: false };
    return {
      path,
      exists: true,
      size: entry.content.length,
      mtime: entry.mtime,
      ctime: 500,
      lineCount: entry.content.split('\n').length,
      hash: contentHash(entry.content),
    };
  }

  async updateFile(path: string, content: string): Promise<any> {
    this.mutations.push({ kind: 'update', path, content });
    const entry = this.files.get(path)!;
    entry.content = content;
    entry.mtime = ++this.nextMtime;
    // Post-write stat, as the real primitive returns it (see the
    // write-primitives describe below).
    return { success: true, path, mtime: entry.mtime, hash: contentHash(content) };
  }

  async appendToFile(path: string, content: string): Promise<any> {
    this.mutations.push({ kind: 'append', path, content });
    const entry = this.files.get(path)!;
    entry.content = entry.content + content;
    entry.mtime = ++this.nextMtime;
    return { success: true, path, mtime: entry.mtime, hash: contentHash(entry.content) };
  }
}

describe('edit write preconditions', () => {
  let api: PreconditionAPI;
  let router: SemanticRouter;

  beforeEach(() => {
    api = new PreconditionAPI();
    router = new SemanticRouter(api);
  });

  test('matching ifHash lets the write through', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'note.md', newText: 'gamma', ifHash: contentHash('alpha\nbeta') },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ kind: 'append', path: 'note.md', content: 'gamma' }]);
  });

  test('mismatched ifHash refuses with PRECONDITION_FAILED and writes nothing', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'note.md', newText: 'gamma', ifHash: 'deadbeefdeadbeef' },
    });
    expect(response.error?.code).toBe('PRECONDITION_FAILED');
    expect(api.mutations).toEqual([]);
  });

  test('matching ifUnmodifiedSince lets the replace through', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'note.md', oldText: 'beta', newText: 'delta', ifUnmodifiedSince: 1000 },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([
      { kind: 'update', path: 'note.md', content: 'alpha\ndelta' },
    ]);
  });

  test('mismatched ifUnmodifiedSince refuses with PRECONDITION_FAILED and writes nothing', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'note.md', oldText: 'beta', newText: 'delta', ifUnmodifiedSince: 999 },
    });
    expect(response.error?.code).toBe('PRECONDITION_FAILED');
    expect(api.mutations).toEqual([]);
  });

  test('a precondition on a missing file refuses instead of creating it', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'ghost.md', newText: 'x', ifHash: 'deadbeefdeadbeef' },
    });
    expect(response.error?.code).toBe('PRECONDITION_FAILED');
    expect(api.mutations).toEqual([]);
  });

  test('a malformed precondition fails closed instead of being ignored', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'note.md', newText: 'gamma', ifHash: { nested: true } },
    });
    expect(response.error?.code).toBe('PRECONDITION_FAILED');
    expect(api.mutations).toEqual([]);
  });

  test('no precondition parameters: the write proceeds as before', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'note.md', newText: 'gamma' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ kind: 'append', path: 'note.md', content: 'gamma' }]);
  });

  test('a successful write returns the fresh stat, so edits chain without re-reading', async () => {
    const first: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'note.md', oldText: 'beta', newText: 'delta', ifHash: contentHash('alpha\nbeta') },
    });
    expect(first.error).toBeUndefined();
    expect(typeof first.result?.hash).toBe('string');
    expect(typeof first.result?.mtime).toBe('number');

    // Chain: the second edit echoes the stat the first write returned.
    const second: any = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'note.md', newText: '\nepsilon', ifHash: first.result.hash },
    });
    expect(second.error).toBeUndefined();
    expect(api.mutations.length).toBe(2);

    // The original hash is stale now: the chain broke, the write refuses.
    const stale: any = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'note.md', newText: '\nzeta', ifHash: contentHash('alpha\nbeta') },
    });
    expect(stale.error?.code).toBe('PRECONDITION_FAILED');
    expect(api.mutations.length).toBe(2);
  });
});

describe('write primitives return the post-write stat', () => {
  function makeVaultAPI() {
    const store = new Map<string, { content: string; stat: { ctime: number; mtime: number; size: number } }>();
    let clock = 1000;

    const asTFile = (path: string): TFile => {
      const f = new TFile();
      f.path = path;
      f.name = path.split('/').pop()!;
      f.extension = path.split('.').pop()!;
      // Share the stat object with the store so a modify bump is visible on
      // the TFile instance the primitive holds.
      (f as any).stat = store.get(path)!.stat;
      return f;
    };

    const app = new App();
    (app.vault as any).getAbstractFileByPath = (path: string) => (store.has(path) ? asTFile(path) : null);
    (app.vault as any).read = async (f: TFile) => store.get(f.path)!.content;
    (app.vault as any).cachedRead = async (f: TFile) => store.get(f.path)!.content;
    (app.vault as any).modify = async (f: TFile, content: string) => {
      const entry = store.get(f.path)!;
      entry.content = content;
      entry.stat.mtime = ++clock;
      entry.stat.size = content.length;
    };
    (app.vault as any).create = async (path: string, content: string) => {
      store.set(path, { content, stat: { ctime: clock, mtime: ++clock, size: content.length } });
      return asTFile(path);
    };

    return new ObsidianAPI(app);
  }

  test('updateFile returns the new mtime and hash of the written content', async () => {
    const api = makeVaultAPI();
    await api.createFile('a.md', 'one');
    const res: any = await api.updateFile('a.md', 'one\ntwo');
    expect(res.success).toBe(true);
    expect(res.hash).toBe(contentHash('one\ntwo'));
    expect(res.mtime).toBeGreaterThan(1001); // bumped past the create mtime
  });

  test('appendToFile returns the stat of the combined content', async () => {
    const api = makeVaultAPI();
    await api.createFile('a.md', 'one');
    const res: any = await api.appendToFile('a.md', '\ntwo');
    expect(res.hash).toBe(contentHash('one\ntwo'));
    expect(typeof res.mtime).toBe('number');
  });

  test('patchVaultFile returns the stat alongside updated_content', async () => {
    const api = makeVaultAPI();
    await api.createFile('a.md', 'alpha beta');
    const res: any = await api.patchVaultFile('a.md', {
      operation: 'replace', old_text: 'beta', new_text: 'gamma'
    });
    expect(res.updated_content).toBe('alpha gamma');
    expect(res.hash).toBe(contentHash('alpha gamma'));
    expect(typeof res.mtime).toBe('number');
  });

  test('createFile returns the stat of the created file', async () => {
    const api = makeVaultAPI();
    const res: any = await api.createFile('new.md', 'fresh');
    expect(res.hash).toBe(contentHash('fresh'));
    expect(typeof res.mtime).toBe('number');
  });
});
