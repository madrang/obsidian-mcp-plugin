/**
 * edit.multi — several exact find-and-replace pairs applied in one write
 * (Option A of the 2026-08 review: a dedicated action, exact-match only,
 * sequential application, all-or-nothing, batch-size capped).
 *
 * Assertions are on recorded writes: a refused batch must leave zero
 * mutations, the #210 discipline.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { contentHash } from '../src/utils/content-hash';
import { createTools } from '../src/tools/tool-factory';
import { App } from 'obsidian';

class MultiAPI extends ObsidianAPI {
  readonly mutations: { path: string; content: string }[] = [];
  private files = new Map<string, { content: string; mtime: number }>([
    ['note.md', { content: 'alpha draft beta TODO gamma', mtime: 1000 }],
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

  async getFileStat(path: string): Promise<any> {
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
    this.mutations.push({ path, content });
    const entry = this.files.get(path)!;
    entry.content = content;
    entry.mtime = ++this.nextMtime;
    return { success: true, path, mtime: entry.mtime, hash: contentHash(content) };
  }
}

describe('edit.multi', () => {
  let api: MultiAPI;
  let router: VaultRouter;

  beforeEach(() => {
    api = new MultiAPI();
    router = new VaultRouter(api);
  });

  const pairs = (...list: [string, string][]) =>
    list.map(([oldText, newText]) => ({ oldText, newText }));

  test('applies every pair in one write and returns the fresh stat', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'note.md', edits: pairs(['draft', 'final'], ['TODO', 'DONE']) },
    });
    expect(response.error).toBeUndefined();
    expect(response.result.applied).toBe(2);
    expect(response.result.hash).toBe(contentHash('alpha final beta DONE gamma'));
    expect(typeof response.result.mtime).toBe('number');
    // One write, not one per pair.
    expect(api.mutations).toEqual([
      { path: 'note.md', content: 'alpha final beta DONE gamma' },
    ]);
  });

  test('pairs apply sequentially: pair 2 can target text pair 1 created', async () => {
    await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'note.md', edits: pairs(['draft', 'review'], ['review', 'final']) },
    });
    expect(api.mutations[0].content).toBe('alpha final beta TODO gamma');
  });

  test('each pair replaces the first occurrence only', async () => {
    api['files'].set('dup.md', { content: 'x x x', mtime: 1000 });
    await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'dup.md', edits: pairs(['x', 'y']) },
    });
    expect(api.mutations[0].content).toBe('y x x');
  });

  test('a pair matches across the quote classes (typographic file, ASCII pair)', async () => {
    api['files'].set('typo.md', { content: 'l\u2019équipement is ready', mtime: 1000 });
    await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'typo.md', edits: pairs(["l'équipement", 'the equipment']) },
    });
    expect(api.mutations[0].content).toBe('the equipment is ready');
  });

  test('a pair that does not match refuses the whole batch, nothing written', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'note.md', edits: pairs(['draft', 'final'], ['ABSENT', 'x']) },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain('pair 2 of 2');
    expect(response.error.message).toContain('Nothing was written');
    expect(api.mutations).toEqual([]);
    expect((await api.getFile('note.md')).content).toBe('alpha draft beta TODO gamma');
  });

  test('an empty edits array rejects without touching the vault', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'note.md', edits: [] },
    });
    expect(response.error).toBeDefined();
    expect(api.mutations).toEqual([]);
  });

  test('a malformed pair rejects and names its position', async () => {
    const response: any = await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'note.md', edits: [{ oldText: 'draft', newText: 'final' }, { oldText: '' , newText: 'x' }] },
    });
    expect(response.error.message).toContain('pair 2');
    expect(api.mutations).toEqual([]);
  });

  test('more pairs than the batch limit rejects before any read', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ oldText: `t${i}`, newText: `r${i}` }));
    const response: any = await router.route({
      operation: 'edit',
      action: 'multi',
      params: { path: 'note.md', edits: many },
    });
    expect(response.error.message).toContain('exceeds maximum');
    expect(api.mutations).toEqual([]);
  });

  test('works with the ifHash precondition like every edit action', async () => {
    const first: any = await router.route({
      operation: 'edit',
      action: 'multi',
      params: {
        path: 'note.md',
        edits: pairs(['draft', 'final']),
        ifHash: contentHash('alpha draft beta TODO gamma'),
      },
    });
    expect(first.error).toBeUndefined();

    const stale: any = await router.route({
      operation: 'edit',
      action: 'multi',
      params: {
        path: 'note.md',
        edits: pairs(['TODO', 'DONE']),
        ifHash: contentHash('alpha draft beta TODO gamma'),
      },
    });
    expect(stale.error?.code).toBe('PRECONDITION_FAILED');
    expect(api.mutations.length).toBe(1);
  });

  test('the tool schema advertises multi with path and edits required', () => {
    const edit = createTools().find(t => t.name === 'edit');
    const enumActions = (edit!.inputSchema.properties.action as { enum: string[] }).enum;
    expect(enumActions).toContain('multi');
    const conditional = (edit!.inputSchema.allOf ?? []).find(
      (c: any) => c.if.properties.action.const === 'multi'
    );
    expect(conditional).toBeDefined();
    expect((conditional as { then: { required: string[] } }).then.required).toEqual(['path', 'edits']);
  });
});
