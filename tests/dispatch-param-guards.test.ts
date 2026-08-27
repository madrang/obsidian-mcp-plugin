/**
 * Regression tests for #210 — a whole-file write with missing `content`
 * wrote the literal string "undefined" to files. The fix moved required-param
 * checks to the dispatch boundary so a malformed MCP call cannot reach a
 * vault sink with `String(undefined)`.
 *
 * Under the current surface the corruption class looks different. files.create
 * treats missing content as a legitimate empty file (a "touch"), so the pin
 * that matters is that create writes '' and never "undefined". The edit
 * actions keep strict required-param guards. These tests cover both, plus
 * the path-only guards.
 *
 * Strategy: a mock API records every mutation. After a malformed call we
 * assert the call threw AND that no mutation was recorded. The guard must
 * run before any sink, not after.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { App } from 'obsidian';

type Mutation =
  | { kind: 'update'; path: string; content: string }
  | { kind: 'append'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'create'; path: string; content: string };

class RecordingAPI extends ObsidianAPI {
  readonly mutations: Mutation[] = [];
  readonly reads: string[] = [];
  private files = new Map<string, string>([['existing.md', 'original']]);

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<any> {
    this.reads.push(path);
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return { content, path, type: 'text' };
  }

  async updateFile(path: string, content: string): Promise<any> {
    this.mutations.push({ kind: 'update', path, content });
    this.files.set(path, content);
    return { success: true, path };
  }

  async appendToFile(path: string, content: string): Promise<any> {
    this.mutations.push({ kind: 'append', path, content });
    const prev = this.files.get(path) ?? '';
    this.files.set(path, prev + content);
    return { success: true, path };
  }

  async deleteFile(path: string): Promise<any> {
    this.mutations.push({ kind: 'delete', path });
    this.files.delete(path);
    return { success: true, path };
  }

  async createFile(path: string, content: string): Promise<any> {
    this.mutations.push({ kind: 'create', path, content });
    this.files.set(path, content);
    return { success: true, path };
  }
}

describe('dispatch-level param guards (#210)', () => {
  let api: RecordingAPI;
  let router: VaultRouter;

  beforeEach(() => {
    api = new RecordingAPI();
    router = new VaultRouter(api);
  });

  // Whole-file replacement is create with overwrite=true: the write goes
  // through updateFile, and the overwrite marker drives the "Updated" verb.
  test('create with overwrite=true replaces content and returns path', async () => {
    const response: any = await router.route({
      operation: 'files',
      action: 'create',
      params: { path: 'existing.md', content: 'new body', overwrite: true },
    });
    expect(response.result).toMatchObject({ success: true, path: 'existing.md', overwritten: true });
    expect(api.mutations).toEqual([
      { kind: 'update', path: 'existing.md', content: 'new body' },
    ]);
  });

  test('files.delete without path rejects', async () => {
    const response = await router.route({
      operation: 'files',
      action: 'delete',
      params: {},
    });
    expect((response as any).error).toBeDefined();
    expect(api.mutations).toEqual([]);
  });

  // The #210 corruption class under the current surface: create treats
  // missing content as a "touch", so it must write an empty file and never
  // the literal string "undefined".
  test('create without content writes an empty file, never "undefined"', async () => {
    const response: any = await router.route({
      operation: 'files',
      action: 'create',
      params: { path: 'touched.md' },
    });
    expect(response.error).toBeUndefined();
    expect(api.mutations).toEqual([
      { kind: 'create', path: 'touched.md', content: '' },
    ]);
  });

  test('create without path rejects', async () => {
    const response = await router.route({
      operation: 'files',
      action: 'create',
      params: { content: 'body' },
    });
    expect((response as any).error).toBeDefined();
    expect(api.mutations).toEqual([]);
  });

  test('edit.append without newText rejects without touching the vault', async () => {
    const response = await router.route({
      operation: 'edit',
      action: 'append',
      params: { path: 'existing.md' },
    });
    expect((response as any).error).toBeDefined();
    expect(api.mutations).toEqual([]);
    expect((await api.getFile('existing.md')).content).toBe('original');
  });

  test('edit.replace without oldText/newText rejects before reading or writing the file', async () => {
    const response = await router.route({
      operation: 'edit',
      action: 'replace',
      params: { path: 'existing.md' },
    });
    expect((response as any).error).toBeDefined();
    expect(api.mutations).toEqual([]);
    // The guard must run before performWindowEdit fetches the file —
    // otherwise a missing oldText could still trigger a search for the
    // literal string "undefined" with confusing diagnostics.
    expect(api.reads).toEqual([]);
  });

  test('edit.* without path rejects before taking a file lock', async () => {
    const response = await router.route({
      operation: 'edit',
      action: 'append',
      params: { content: 'whatever' },
    });
    expect((response as any).error).toBeDefined();
    expect(api.mutations).toEqual([]);
  });

  // Belt-and-suspenders for the second fix in #210: even if a guard ever
  // misses, the response carries `path` so the formatter can't render
  // "Updated: undefined" to the user.
  test('updateFile success response includes path for the formatter', async () => {
    const result = await api.updateFile('existing.md', 'x');
    expect(result).toMatchObject({ success: true, path: 'existing.md' });
  });
});
