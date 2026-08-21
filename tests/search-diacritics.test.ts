/**
 * Accented words must survive search tokenization.
 *
 * Reported live by RedBot (vault RedBot-Notebook/, Review Outils.md):
 * `view.search "leçon"` returned 0 results while Main.md contained the
 * word. Every tokenizer in the search path replaced non-ASCII-\w
 * characters with spaces, so an accented word split at its first accent
 * and the fragments died in the length filter. The fix is the Unicode
 * superset: [\p{L}\p{N}_] under the u flag, which keeps every ASCII word
 * character behaving exactly as before. These pins replay the report
 * end to end through the same API layer the tool surface calls.
 */
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { App, TFile } from 'obsidian';

function makeFile(path: string): TFile {
  const f = Object.create(TFile.prototype);
  Object.assign(f, {
    path,
    name: path.split('/').pop()!,
    basename: path.split('/').pop()!.replace(/\.[^/.]+$/, ''),
    extension: path.split('.').pop() || 'md',
    stat: { size: 123, mtime: Date.now() }
  });
  return f as TFile;
}

function makeMockApp(files: Record<string, string>): App {
  const fileList = Object.keys(files).map(makeFile);
  return {
    vault: {
      getFiles: jest.fn(() => fileList),
      getMarkdownFiles: jest.fn(() => fileList),
      read: jest.fn(async (f: TFile) => files[f.path] ?? ''),
      cachedRead: jest.fn(async (f: TFile) => files[f.path] ?? ''),
    },
    metadataCache: {
      getFileCache: jest.fn(() => ({})),
    },
  } as unknown as App;
}

describe('search with accented words', () => {
  test('the reported case: query "leçon" finds the note that contains it', async () => {
    const api = new ObsidianAPI(makeMockApp({
      'a.md': 'la leçon du jour',
      'b.md': 'une autre note',
    }));
    const res = await api.searchPaginated('leçon');
    expect(res.results.map(r => r.path)).toContain('a.md');
  });

  test('a word with multiple accents stays one token', async () => {
    const api = new ObsidianAPI(makeMockApp({
      'a.md': 'un éléphant gris',
      'b.md': 'du texte sans rapport',
    }));
    const res = await api.searchPaginated('éléphant');
    expect(res.results.map(r => r.path)).toContain('a.md');
  });

  test('French accented terms match across several notes', async () => {
    const api = new ObsidianAPI(makeMockApp({
      'a.md': 'préparer la réunion',
      'b.md': 'préparer le dîner',
      'c.md': 'rien ici',
    }));
    const res = await api.searchPaginated('préparer');
    expect(res.results.map(r => r.path).sort()).toEqual(['a.md', 'b.md']);
  });

  test('ASCII behavior is unchanged: plain words still match', async () => {
    const api = new ObsidianAPI(makeMockApp({
      'a.md': 'the quick brown fox',
      'b.md': 'nothing relevant',
    }));
    const res = await api.searchPaginated('quick');
    expect(res.results.map(r => r.path)).toEqual(['a.md']);
  });

  test('underscore identifiers still tokenize as one word', async () => {
    // The superset keeps `_` a word character: snake_case must not split.
    const api = new ObsidianAPI(makeMockApp({
      'a.md': 'config read_write_lock enabled',
    }));
    const res = await api.searchPaginated('read_write_lock');
    expect(res.results.map(r => r.path)).toEqual(['a.md']);
  });
});
