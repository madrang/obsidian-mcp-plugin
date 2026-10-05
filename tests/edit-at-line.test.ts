/**
 * edit.at_line placement — where `before` and `after` land the new line
 * relative to the 1-based target. `before` lands above the target line,
 * `after` below it, and a lineNumber one past the last line appends at the
 * end of the file. Assertions are on recorded writes: a misplaced insert
 * still returns success and corrupts the file.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { contentHash } from '../src/utils/content-hash';
import { App } from 'obsidian';

class PlacementAPI extends ObsidianAPI {
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

describe('edit.at_line placement', () => {
  function setup(files: Record<string, string>) {
    const api = new PlacementAPI(files);
    return { api, router: new VaultRouter(api) };
  }

  test('before on line 1 lands above the first line', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 1, mode: 'before', newText: 'top' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'top\none\ntwo\nthree' }]);
  });

  test('before on a middle line shifts the target line down', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 2, mode: 'before', newText: 'inserted' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ninserted\ntwo\nthree' }]);
    expect(response.result.line).toBe(2);
    expect(response.result.mode).toBe('before');
  });

  test('before on the last line lands above it', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 3, mode: 'before', newText: 'inserted' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ntwo\ninserted\nthree' }]);
  });

  test('after on line 1 lands below the first line', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 1, mode: 'after', newText: 'inserted' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ninserted\ntwo\nthree' }]);
  });

  test('after on a middle line lands between it and the next', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 2, mode: 'after', newText: 'inserted' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ntwo\ninserted\nthree' }]);
  });

  test('after on the last line appends at the end of the file', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 3, mode: 'after', newText: 'tail' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ntwo\nthree\ntail' }]);
  });

  test('before one past the last line appends at the end', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 3, mode: 'before', newText: 'tail' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ntwo\ntail' }]);
  });

  test('after one past the last line appends at the end', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 3, mode: 'after', newText: 'tail' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\ntwo\ntail' }]);
  });

  test('the omitted mode replaces the target line', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo\nthree' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 2, newText: 'replaced' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\nreplaced\nthree' }]);
  });

  test('a multi-line newText lands as multiple lines', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 1, mode: 'after', newText: 'a\nb' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([{ path: 'a.md', content: 'one\na\nb\ntwo' }]);
  });

  test('a lineNumber past one beyond the end refuses and writes nothing', async () => {
    const { api, router } = setup({ 'a.md': 'one\ntwo' });
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: 'a.md', lineNumber: 4, mode: 'before', newText: 'x' },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain('Invalid line number');
    expect(api.mutations).toEqual([]);
  });
});
