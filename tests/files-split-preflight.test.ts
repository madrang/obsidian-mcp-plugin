/**
 * files.split pre-flight: every output is named up front, and a collision —
 * an existing file or a duplicate name inside the batch — refuses the split
 * before the first write. Asserted on recorded writes, not error strings:
 * before the pre-flight, outputs written ahead of the collision stayed on
 * disk.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { App } from 'obsidian';

const SOURCE = 'note.md';
const CONTENT = '# Alpha\nfirst\n# Beta\nsecond';

class MockObsidianAPI extends ObsidianAPI {
  readonly created: string[] = [];

  constructor(private existing: Set<string>, app: App) {
    super(app);
  }

  async getFile(path: string): Promise<never> {
    if (!this.existing.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return { path, content: CONTENT } as never;
  }

  async getFileStat(path: string): Promise<never> {
    return { path, exists: this.existing.has(path) } as never;
  }

  async createFile(path: string): Promise<never> {
    this.created.push(path);
    this.existing.add(path);
    return { success: true, path } as never;
  }
}

function setup(existing: string[] = [SOURCE]) {
  const app = { vault: {} } as unknown as App;
  const api = new MockObsidianAPI(new Set(existing), app);
  const router = new VaultRouter(api, app);
  return { api, router };
}

async function split(router: VaultRouter, params: Record<string, unknown>) {
  return router.route({ operation: 'files', action: 'split', params });
}

describe('files.split pre-flight collision check', () => {
  it('an existing output refuses the split and writes nothing', async () => {
    const { api, router } = setup([SOURCE, 'note-002.md']);

    const response = await split(router, { path: SOURCE, splitBy: 'heading' });

    expect(response.error?.message).toContain('Split refused');
    expect(api.created).toEqual([]);
  });

  it('a duplicate output name inside the batch refuses the split and writes nothing', async () => {
    const { api, router } = setup();

    const response = await split(router, {
      path: SOURCE
      , splitBy: 'heading'
      , outputPattern: '{filename}-x{ext}'
    });

    expect(response.error?.message).toContain('Split refused');
    expect(api.created).toEqual([]);
  });

  it('no collision writes every output', async () => {
    const { api, router } = setup();

    const response = await split(router, { path: SOURCE, splitBy: 'heading' });

    expect(response.error).toBeUndefined();
    expect(api.created).toEqual(['note-001.md', 'note-002.md']);
  });
});
