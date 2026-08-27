/**
 * files.split — the split semantics, asserted on the created files. A
 * heading split cuts at headings of exactly the given level. Each output
 * file starts with its heading line. Text before the first heading becomes
 * its own file. {index} is 1-based and zero-padded to three digits.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { App } from 'obsidian';

class SplitAPI extends ObsidianAPI {
  readonly files = new Map<string, string>();
  readonly created = new Map<string, string>();

  constructor(app: App) {
    super(app);
  }

  async getFile(path: string): Promise<any> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return { path, content, tags: [], frontmatter: {} };
  }

  async getFileStat(path: string): Promise<any> {
    return { path, exists: this.files.has(path) };
  }

  async createFile(path: string, content: string): Promise<any> {
    this.created.set(path, content);
    this.files.set(path, content);
    return { success: true, path };
  }
}

function setup(files: Record<string, string>) {
  const app = { vault: {} } as unknown as App;
  const api = new SplitAPI(app);
  for (const [path, content] of Object.entries(files)) api.files.set(path, content);
  const router = new VaultRouter(api, app);
  return { api, router };
}

async function split(router: VaultRouter, params: Record<string, unknown>) {
  return router.route({ operation: 'files', action: 'split', params });
}

describe('files.split', () => {
  test('a heading split cuts at level-1 headings and keeps the preamble as its own file', async () => {
    const { api, router } = setup({
      'note.md': 'Intro text\n\n# Alpha\nalpha body\n\n# Beta\nbeta body',
    });

    const response: any = await split(router, { path: 'note.md', splitBy: 'heading' });

    expect(response.error).toBeUndefined();
    expect(response.result.totalFiles).toBe(3);
    expect([...api.created.keys()]).toEqual(['note-001.md', 'note-002.md', 'note-003.md']);
    expect(api.created.get('note-001.md')).toBe('Intro text');
    expect(api.created.get('note-002.md')).toBe('# Alpha\nalpha body');
    expect(api.created.get('note-003.md')).toBe('# Beta\nbeta body');
  });

  test('each output file starts with its heading line', async () => {
    const { api, router } = setup({
      'note.md': '# Alpha\nalpha body\n\n# Beta\nbeta body',
    });

    await split(router, { path: 'note.md', splitBy: 'heading' });

    expect(api.created.get('note-001.md')!.startsWith('# Alpha')).toBe(true);
    expect(api.created.get('note-002.md')!.startsWith('# Beta')).toBe(true);
  });

  test('a file that starts with a heading produces no empty preamble file', async () => {
    const { api, router } = setup({
      'note.md': '# Alpha\nalpha body\n\n# Beta\nbeta body',
    });

    const response: any = await split(router, { path: 'note.md', splitBy: 'heading' });

    expect(response.result.totalFiles).toBe(2);
    expect([...api.created.keys()]).toEqual(['note-001.md', 'note-002.md']);
  });

  test('level 2 cuts at level-2 headings only: the level-1 heading stays in the preamble', async () => {
    const { api, router } = setup({
      'note.md': '# Top\nintro\n\n## Sub One\none body\n\n## Sub Two\ntwo body',
    });

    const response: any = await split(router, { path: 'note.md', splitBy: 'heading', level: 2 });

    expect(response.error).toBeUndefined();
    expect(response.result.totalFiles).toBe(3);
    expect(api.created.get('note-001.md')).toBe('# Top\nintro');
    expect(api.created.get('note-002.md')).toBe('## Sub One\none body');
    expect(api.created.get('note-003.md')).toBe('## Sub Two\ntwo body');
  });

  test('level 1 leaves a document with only deeper headings as one file', async () => {
    const { api, router } = setup({
      'note.md': '# Top\nintro\n\n## Sub One\none body\n\n## Sub Two\ntwo body',
    });

    const response: any = await split(router, { path: 'note.md', splitBy: 'heading', level: 1 });

    expect(response.result.totalFiles).toBe(1);
    expect(api.created.get('note-001.md')).toBe('# Top\nintro\n\n## Sub One\none body\n\n## Sub Two\ntwo body');
  });

  test('{index} is 1-based and zero-padded to three digits in the default pattern', async () => {
    const { api, router } = setup({
      'report.md': 'pre\n\n# A\na\n\n# B\nb\n\n# C\nc',
    });

    await split(router, { path: 'report.md', splitBy: 'heading' });

    expect([...api.created.keys()]).toEqual(['report-001.md', 'report-002.md', 'report-003.md', 'report-004.md']);
  });

  test('outputPattern placeholders and outputDirectory shape the destination paths', async () => {
    const { api, router } = setup({
      'note.md': '# Alpha\nalpha body\n\n# Beta\nbeta body',
    });

    const response: any = await split(router, {
      path: 'note.md'
      , splitBy: 'heading'
      , outputPattern: '{filename}_{index}{ext}'
      , outputDirectory: 'parts',
    });

    expect(response.error).toBeUndefined();
    expect([...api.created.keys()]).toEqual(['parts/note_001.md', 'parts/note_002.md']);
  });

  test('a section body never leaks into the next section file', async () => {
    const { api, router } = setup({
      'note.md': '# Alpha\nalpha body line one\nalpha body line two\n\n# Beta\nbeta body',
    });

    await split(router, { path: 'note.md', splitBy: 'heading' });

    const alpha = api.created.get('note-001.md')!;
    const beta = api.created.get('note-002.md')!;
    expect(alpha).not.toContain('beta body');
    expect(beta).not.toContain('alpha body');
    expect(beta.endsWith('beta body')).toBe(true);
  });

  test('the response reports each created file with its line count and size', async () => {
    const { router } = setup({
      'note.md': '# Alpha\nalpha body\n\n# Beta\nbeta body',
    });

    const response: any = await split(router, { path: 'note.md', splitBy: 'heading' });

    expect(response.result.createdFiles).toEqual([
      { path: 'note-001.md', lines: 2, size: '# Alpha\nalpha body'.length },
      { path: 'note-002.md', lines: 2, size: '# Beta\nbeta body'.length },
    ]);
  });
});
