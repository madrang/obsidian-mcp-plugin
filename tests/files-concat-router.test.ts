/**
 * files.concat always writes. The inline mode (no destination → combined
 * content returned, nothing written) made concat a read hiding in a write
 * tool, and is gone: destination is required, advertised in the schema
 * conditionals, enforced at dispatch with MISSING_PARAMETER, and backstopped
 * here at the router level. These assert on RECORDED WRITES, not error
 * strings.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { App } from 'obsidian';

type Write = { kind: 'create' | 'update'; path: string; content: string };

// Minimal text-file mock — combine needs getFile for sources and the
// destination check, and create/update to record the write.
class MockAPI extends ObsidianAPI {
  private files = new Map<string, string>([
    ['a.md', 'ALPHA'],
    ['b.md', 'BRAVO'],
    ['c.md', 'CHARLIE'],
  ]);
  readonly writes: Write[] = [];

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<any> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return { content, path, type: 'text' };
  }

  async createFile(path: string, content: string): Promise<any> {
    this.writes.push({ kind: 'create', path, content });
    this.files.set(path, content);
    return { success: true, path };
  }

  async updateFile(path: string, content: string): Promise<any> {
    this.writes.push({ kind: 'update', path, content });
    this.files.set(path, content);
    return { success: true, path };
  }
}

describe('files.concat — destination required (router level)', () => {
  let api: MockAPI;
  let router: VaultRouter;

  beforeEach(() => {
    api = new MockAPI();
    router = new VaultRouter(api);
  });

  test('no destination rejects and writes nothing', async () => {
    const response: any = await router.route({
      operation: 'files',
      action: 'concat',
      params: { paths: ['a.md', 'b.md'], separator: '\n' },
    });

    expect(response.error).toBeDefined();
    expect(api.writes).toEqual([]);
  });

  test('concat writes the combined content to the destination', async () => {
    const { result }: any = await router.route({
      operation: 'files',
      action: 'concat',
      params: { paths: ['a.md', 'b.md'], separator: '\n', destination: 'combined.md' },
    });

    expect(result.success).toBe(true);
    expect(result.destination).toBe('combined.md');
    expect(api.writes).toEqual([
      { kind: 'create', path: 'combined.md', content: 'ALPHA\nBRAVO' },
    ]);
  });

  test('a sorted combine writes the sections in sorted order', async () => {
    const { result }: any = await router.route({
      operation: 'files',
      action: 'concat',
      params: {
        paths: ['a.md', 'b.md', 'c.md'],
        separator: '\n---\n',
        sortBy: 'name',
        sortOrder: 'desc',
        destination: 'sorted.md',
      },
    });

    expect(result.filesCombined).toBe(3);
    expect(api.writes).toEqual([
      { kind: 'create', path: 'sorted.md', content: 'CHARLIE\n---\nBRAVO\n---\nALPHA' },
    ]);
  });

  test('an existing destination without overwrite rejects and writes nothing', async () => {
    await router.route({
      operation: 'files',
      action: 'concat',
      params: { paths: ['b.md', 'c.md'], destination: 'a.md' },
    });

    expect(api.writes).toEqual([]);
  });
});
