/**
 * files move with a bare destination (in-place rename) — extension preservation (#253).
 *
 * Drives the real SemanticRouter -> executeFilesOperation path. Only the vault I/O
 * boundary is stubbed (ObsidianAPI.getFile, app.fileManager.renameFile), so the path
 * construction under test is the shipped one. The rename action had no behavioural
 * test at all before this, which is why the dropped extension shipped.
 *
 * rename has since merged into move: the tool surface exposes a bare destination,
 * and the write goes through ObsidianAPI.moveFile (so the security layer can
 * validate the destination) rather than reaching for app.fileManager directly.
 *
 * The API and the app must share one App instance, as they do in production.
 */
import { SemanticRouter } from '../src/semantic/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { App, TFile } from 'obsidian';

interface RenameResult {
  success: boolean;
  oldPath: string;
  newPath: string;
}

class MockObsidianAPI extends ObsidianAPI {
  constructor(private existing: Set<string>, app: App) {
    super(app);
  }

  async getFile(path: string): Promise<never> {
    if (!this.existing.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return { path, content: 'body' } as never;
  }
}

/**
 * Fake Obsidian app that records the destination handed to fileManager.renameFile —
 * the actual side effect a rename produces on the vault.
 */
function fakeApp(existing: Set<string>, renamed: string[]): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) =>
        existing.has(path) ? ({ path, extension: 'md' } as unknown as TFile) : null
    },
    fileManager: {
      renameFile: async (_file: TFile, newPath: string) => {
        renamed.push(newPath);
      }
    }
  } as unknown as App;
}

async function rename(source: string, dest: string): Promise<{ result: RenameResult; renamed: string[] }> {
  const existing = new Set([source]);
  const renamed: string[] = [];
  const app = fakeApp(existing, renamed);
  const router = new SemanticRouter(new MockObsidianAPI(existing, app), app);

  const response = await router.route({
    operation: 'files',
    action: 'move',
    params: { path: source, destination: dest }
  });

  return { result: response.result as unknown as RenameResult, renamed };
}

describe('files move with a bare destination — extension handling (#253)', () => {
  it('should preserve the source extension when destination omits one', async () => {
    const { result, renamed } = await rename('work/my-note.md', 'my-renamed');

    expect(result.newPath).toBe('work/my-renamed.md');
    expect(renamed).toEqual(['work/my-renamed.md']);
  });

  it('should not double up the extension when destination already has one', async () => {
    const { result, renamed } = await rename('work/my-note.md', 'my-renamed.md');

    expect(result.newPath).toBe('work/my-renamed.md');
    expect(renamed).toEqual(['work/my-renamed.md']);
  });

  it('should preserve a non-markdown source extension', async () => {
    const { result } = await rename('assets/diagram.png', 'architecture');

    expect(result.newPath).toBe('assets/architecture.png');
  });

  it('should honour an explicit different extension in destination', async () => {
    const { result } = await rename('work/my-note.md', 'my-renamed.txt');

    expect(result.newPath).toBe('work/my-renamed.txt');
  });

  it('should preserve the extension for a file at the vault root', async () => {
    const { result } = await rename('note.md', 'renamed');

    expect(result.newPath).toBe('renamed.md');
  });

  it('should leave an extension-less source extension-less', async () => {
    const { result } = await rename('work/LICENSE', 'COPYING');

    expect(result.newPath).toBe('work/COPYING');
  });
});
