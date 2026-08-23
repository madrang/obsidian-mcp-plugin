/**
 * edit.replace count guard — `expected` is both the guard and the selector.
 * Default 1: exactly one occurrence, that one is replaced. N above 1: exactly
 * N, all replaced. Any other count refuses with MATCH_COUNT_MISMATCH and
 * nothing is written. Assertions are on recorded writes: a refusal that still
 * wrote would pass an error-string test and corrupt the file.
 */
import { SemanticRouter } from '../src/semantic/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { contentHash } from '../src/utils/content-hash';
import { ContentBufferManager } from '../src/utils/content-buffer';
import { App } from 'obsidian';

class CountAPI extends ObsidianAPI {
  readonly mutations: { path: string; content: string }[] = [];
  private files = new Map<string, { content: string; mtime: number }>();

  constructor(files: Record<string, string> = {}) {
    super({} as App);
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, { content, mtime: 1000 });
    }
  }

  async getFile(path: string): Promise<any> {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`File not found: ${path}`);
    return { path, content: entry.content, mtime: entry.mtime, tags: [], frontmatter: {} };
  }

  async updateFile(path: string, content: string): Promise<any> {
    this.mutations.push({ path, content });
    const entry = this.files.get(path)!;
    entry.content = content;
    entry.mtime++;
    return { success: true, path, mtime: entry.mtime, hash: contentHash(content) };
  }
}

describe('edit.replace count guard', () => {
  function setup(files: Record<string, string>) {
    const api = new CountAPI(files);
    return { api, router: new SemanticRouter(api) };
  }

  test('default expected=1 replaces the single occurrence', async () => {
    const { api, router } = setup({ 'a.md': 'one draft two' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'draft', newText: 'final' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one final two' }]);
    expect(typeof response.result.mtime).toBe('number');
    expect(response.result.hash).toBe(contentHash('one final two'));
  });

  test('two occurrences with no expected refuses instead of silently replacing the first', async () => {
    const { api, router } = setup({ 'a.md': 'X one X two' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'X', newText: 'Y' },
    });
    expect(response.error?.code).toBe('MATCH_COUNT_MISMATCH');
    expect(response.error?.message).toContain('expected 1, found 2');
    expect(api.mutations).toEqual([]);
  });

  test('expected=N replaces all N occurrences in one write', async () => {
    const { api, router } = setup({ 'a.md': 'X one X two X' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'X', newText: 'Y', expected: 3 },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'Y one Y two Y' }]);
  });

  test('expected above the actual count refuses', async () => {
    const { api, router } = setup({ 'a.md': 'X one' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'X', newText: 'Y', expected: 3 },
    });
    expect(response.error?.code).toBe('MATCH_COUNT_MISMATCH');
    expect(response.error?.message).toContain('expected 3, found 1');
    expect(api.mutations).toEqual([]);
  });

  test('an explicit expected never falls back to fuzzy — zero matches refuses', async () => {
    const { api, router } = setup({ 'a.md': 'unrelated content' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'absent', newText: 'Y', expected: 1 },
    });
    expect(response.error?.code).toBe('MATCH_COUNT_MISMATCH');
    expect(response.error?.message).toContain('found 0');
    expect(api.mutations).toEqual([]);
  });

  test('omitted expected with zero matches keeps the legacy fuzzy recovery', async () => {
    const { api, router } = setup({ 'a.md': 'planning notes' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'totaly-absent-text', newText: 'Y' },
    });
    expect(response.error).toBeDefined();
    expect(api.mutations).toEqual([]);
  });

  test('a malformed expected fails closed', async () => {
    const { api, router } = setup({ 'a.md': 'one draft two' });
    for (const bad of [0, -1, 1.5, 'two' as unknown]) {
      const response: any = await router.route({
        operation: 'edit',
        action: 'replace',
        params: { path: 'a.md', oldText: 'draft', newText: 'final', expected: bad },
      });
      expect(response.error).toBeDefined();
    }
    expect(api.mutations).toEqual([]);
  });

  test('a mismatched replace buffers the content; a bare replace reuses it', async () => {
    const { api, router } = setup({ 'a.md': 'tag one tag two' });
    const refused: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'tag', newText: 'label' },
    });
    expect(refused.error?.code).toBe('MATCH_COUNT_MISMATCH');

    // Retry without newText: the buffered replacement is the text, and the
    // count guard passes with expected. from_buffer used to own this case.
    const retry: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'tag', expected: 2 },
    });
    expect(retry.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'label one label two' }]);
    ContentBufferManager.getInstance().clear?.();
  });

  test('replace without newText and without a buffer refuses, writing nothing', async () => {
    ContentBufferManager.getInstance().clear?.();
    const { api, router } = setup({ 'a.md': 'tag one' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'tag' },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain('newText');
    expect(api.mutations).toEqual([]);
  });

  test('newText as an empty string is a real value: it deletes the match', async () => {
    const { api, router } = setup({ 'a.md': 'keep drop keep' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'a.md', oldText: 'drop', newText: '' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'keep  keep' }]);
  });

  test('at_line blanks the line when newText is an empty string', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 2, newText: '' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\n\nthree' }]);
  });

  test('at_line without newText reuses the buffered replacement', async () => {
    ContentBufferManager.getInstance().store('inserted', undefined, { searchText: 'x' });
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 2, mode: 'after' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ntwo\ninserted\nthree' }]);
    ContentBufferManager.getInstance().clear?.();
  });

  test('at_line without newText and without a buffer refuses, writing nothing', async () => {
    ContentBufferManager.getInstance().clear?.();
    const { api, router } = setup({ 'a.md': 'one' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 1 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain('newText');
    expect(api.mutations).toEqual([]);
  });
});
