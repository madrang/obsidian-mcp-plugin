/**
 * view.grep — regex scan returning path:line:column plus the matching line.
 * The count a grep returns is the `expected` value a count-guarded
 * edit.replace accepts, so the addresses must be exact: 1-based line and
 * column, one entry per match, in line order.
 */
import { SemanticRouter } from '../src/semantic/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { createSemanticTools } from '../src/tools/semantic-tools';
import { grepContent } from '../src/utils/grep-search';
import { App } from 'obsidian';

class GrepAPI extends ObsidianAPI {
  files = new Map<string, string>();

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<any> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return { path, content, tags: [], frontmatter: {} };
  }
}

function makeApp(paths: string[]): App {
  return {
    vault: {
      getMarkdownFiles: () => paths.map(p => ({ path: p }))
    }
  } as unknown as App;
}

describe('view.grep', () => {
  function setup(files: Record<string, string>) {
    const api = new GrepAPI();
    for (const [path, content] of Object.entries(files)) api.files.set(path, content);
    const router = new SemanticRouter(api, makeApp(Object.keys(files)));
    return { api, router };
  }

  test('returns path, 1-based line, 1-based column, and the matching line', async () => {
    const { router } = setup({
      'a.md': 'first line\nhas TODO here\nthird line',
      'b.md': 'another TODO'
    });
    const response: any = await router.route({
      operation: 'view',
      action: 'grep',
      params: { pattern: 'TODO' },
    });
    expect(response.error).toBeUndefined();
    expect(response.result.totalMatches).toBe(2);
    expect(response.result.matches[0]).toEqual({
      path: 'a.md', line: 2, column: 5, text: 'has TODO here'
    });
    expect(response.result.matches[1]).toEqual({
      path: 'b.md', line: 1, column: 9, text: 'another TODO'
    });
  });

  test('two matches on one line are separate entries with distinct columns', async () => {
    const { router } = setup({ 'a.md': 'x and x again' });
    const response: any = await router.route({
      operation: 'view',
      action: 'grep',
      params: { pattern: 'x' },
    });
    expect(response.result.matches).toEqual([
      { path: 'a.md', line: 1, column: 1, text: 'x and x again' },
      { path: 'a.md', line: 1, column: 7, text: 'x and x again' }
    ]);
  });

  test('path scopes the scan to one file', async () => {
    const { router } = setup({ 'a.md': 'hit', 'b.md': 'hit' });
    const response: any = await router.route({
      operation: 'view',
      action: 'grep',
      params: { pattern: 'hit', path: 'b.md' },
    });
    expect(response.result.matches.map((m: any) => m.path)).toEqual(['b.md']);
    expect(response.result.filesScanned).toBe(1);
  });

  test('directory scopes the scan to a subtree', async () => {
    const { router } = setup({
      'notes/a.md': 'hit',
      'notes/sub/b.md': 'hit',
      'other/c.md': 'hit'
    });
    const response: any = await router.route({
      operation: 'view',
      action: 'grep',
      params: { pattern: 'hit', directory: 'notes' },
    });
    const paths = response.result.matches.map((m: any) => m.path).sort();
    expect(paths).toEqual(['notes/a.md', 'notes/sub/b.md']);
  });

  test('an invalid regex errors instead of scanning', async () => {
    const { router } = setup({ 'a.md': 'text' });
    const response: any = await router.route({
      operation: 'view',
      action: 'grep',
      params: { pattern: '([unclosed' },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain('regular expression');
  });

  test('maxResults truncates and flags the result', async () => {
    const { router } = setup({ 'a.md': 'v\nv\nv\nv\nv' });
    const response: any = await router.route({
      operation: 'view',
      action: 'grep',
      params: { pattern: 'v', maxResults: 3 },
    });
    expect(response.result.totalMatches).toBe(3);
    expect(response.result.truncated).toBe(true);
  });

  test('zero matches is a clean empty result', async () => {
    const { router } = setup({ 'a.md': 'nothing relevant' });
    const response: any = await router.route({
      operation: 'view',
      action: 'grep',
      params: { pattern: 'zzz' },
    });
    expect(response.result.totalMatches).toBe(0);
    expect(response.result.matches).toEqual([]);
    expect(response.result.truncated).toBe(false);
  });

  test('the tool schema advertises grep with pattern required', () => {
    const view = createSemanticTools().find(t => t.name === 'view');
    const enumActions = (view!.inputSchema.properties.action as { enum: string[] }).enum;
    expect(enumActions).toContain('grep');
    const conditional = (view!.inputSchema.allOf ?? []).find(
      (c: any) => c.if.properties.action.const === 'grep'
    );
    expect(conditional).toBeDefined();
    expect((conditional as { then: { required: string[] } }).then.required).toEqual(['pattern']);
  });
});

describe('grepContent (scanner)', () => {
  test('honors the limit and stops scanning past it', () => {
    const matches = grepContent('a.md', 'm\nm\nm', /m/g, 2);
    expect(matches).toHaveLength(2);
    expect(matches[1].line).toBe(2);
  });
});
