/**
 * view.lines — exact line-range addressing, the deterministic counterpart to
 * view.window's derived bounds. The bounds belong to the caller, so the
 * addresses the other tools work with (1-based lines, from view.grep or a
 * paged read) must survive unchanged: what is asked is what is returned.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { createTools } from '../src/tools/tool-factory';
import { App } from 'obsidian';

class LinesAPI extends ObsidianAPI {
  readonly files = new Map<string, string>();
  readonly reads: string[] = [];

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<any> {
    this.reads.push(path);
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return { path, content, tags: [], frontmatter: {} };
  }
}

function tenLineFile(): string {
  return Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('view.lines', () => {
  function setup(files: Record<string, string>) {
    const api = new LinesAPI();
    for (const [path, content] of Object.entries(files)) api.files.set(path, content);
    const router = new VaultRouter(api, {} as App);
    return { api, router };
  }

  test('returns exactly the requested inclusive 1-based range', async () => {
    const { router } = setup({ 'a.md': tenLineFile() });
    const response: any = await router.route({
      operation: 'view',
      action: 'lines',
      params: { path: 'a.md', startLine: 4, endLine: 7 },
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      path: 'a.md',
      lines: ['line 4', 'line 5', 'line 6', 'line 7'],
      startLine: 4,
      endLine: 7,
      totalLines: 10,
    });
  });

  test('a single-line range is startLine === endLine', async () => {
    const { router } = setup({ 'a.md': tenLineFile() });
    const response: any = await router.route({
      operation: 'view',
      action: 'lines',
      params: { path: 'a.md', startLine: 9, endLine: 9 },
    });
    expect(response.result.lines).toEqual(['line 9']);
    expect(response.result.endLine).toBe(9);
  });

  test('the whole file via 1..totalLines is exact', async () => {
    const { router } = setup({ 'a.md': tenLineFile() });
    const response: any = await router.route({
      operation: 'view',
      action: 'lines',
      params: { path: 'a.md', startLine: 1, endLine: 10 },
    });
    expect(response.result.lines).toHaveLength(10);
    expect(response.result.lines[9]).toBe('line 10');
  });

  test('endLine past the end clamps to the file length', async () => {
    const { router } = setup({ 'a.md': tenLineFile() });
    const response: any = await router.route({
      operation: 'view',
      action: 'lines',
      params: { path: 'a.md', startLine: 8, endLine: 99 },
    });
    expect(response.error).toBeUndefined();
    expect(response.result.lines).toEqual(['line 8', 'line 9', 'line 10']);
    expect(response.result.endLine).toBe(10);
    expect(response.result.totalLines).toBe(10);
  });

  test('startLine past the end errors naming the file length', async () => {
    const { router } = setup({ 'a.md': tenLineFile() });
    const response: any = await router.route({
      operation: 'view',
      action: 'lines',
      params: { path: 'a.md', startLine: 11, endLine: 15 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain('11');
    expect(response.error.message).toContain('10 lines');
  });

  test('a partial read carries no mtime or hash', async () => {
    // The stats rule settled with the view.stat item: only a complete
    // view.read returns them, so a range read must not.
    const { router } = setup({ 'a.md': tenLineFile() });
    const response: any = await router.route({
      operation: 'view',
      action: 'lines',
      params: { path: 'a.md', startLine: 1, endLine: 10 },
    });
    expect(response.result.mtime).toBeUndefined();
    expect(response.result.hash).toBeUndefined();
  });

  test.each([
    ['endLine below startLine', { startLine: 7, endLine: 4 }],
    ['startLine below 1', { startLine: 0, endLine: 4 }],
    ['non-integer bounds', { startLine: 2.5, endLine: 4 }],
    ['string bounds', { startLine: '2', endLine: '4' }],
    ['missing endLine', { startLine: 2 }],
  ])('malformed bounds (%s) error before any read', async (_name, bounds) => {
    const { api, router } = setup({ 'a.md': tenLineFile() });
    const response: any = await router.route({
      operation: 'view',
      action: 'lines',
      params: { path: 'a.md', ...bounds },
    });
    expect(response.error).toBeDefined();
    // The guard runs at the dispatch boundary: the file is never read, so a
    // malformed range cannot cost a vault access (same rule as #210).
    expect(api.reads).toEqual([]);
  });

  test('the tool schema advertises lines with path, startLine, endLine required', () => {
    const view = createTools().find(t => t.name === 'view');
    const enumActions = (view!.inputSchema.properties.action as { enum: string[] }).enum;
    expect(enumActions).toContain('lines');
    const conditional = (view!.inputSchema.allOf ?? []).find(
      (c: any) => c.if.properties.action.const === 'lines'
    );
    expect(conditional).toBeDefined();
    expect((conditional as { then: { required: string[] } }).then.required)
      .toEqual(['path', 'startLine', 'endLine']);
  });
});
