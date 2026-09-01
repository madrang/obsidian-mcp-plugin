/**
 * has_tags, the tags array in the response context, and the tag count in
 * the view.read suggested_next hint must describe the current file's live
 * tag state on every action. The context fields used to read state tokens
 * that only view.read refreshed, so window/create responses reported
 * has_tags: false for tagged files, and the tags of the previously read
 * file leaked into responses about another file. The hint counted /#\w+/g
 * matches on the raw text: duplicates counted twice, hyphenated tags
 * truncated, and frontmatter tags invisible.
 */
import { App } from 'obsidian';
import { VaultRouter } from '../src/tools/router';
import { generateEnhancedHints } from '../src/tools/system/hints';
import { ContentBufferManager } from '../src/utils/content-buffer';

interface StubReadResult {
  path: string;
  content: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  mtime: number;
  hash: string;
}

function stubApi(files: Record<string, StubReadResult>) {
  return {
    getFile: async (path: string) => {
      const file = files[path];
      if (!file) throw new Error(`File not found: ${path}`);
      return file;
    },
    createFile: async () => ({ success: true }),
    updateFile: async () => ({ success: true, mtime: 2, hash: 'h' }),
    getIgnoreManager: () => undefined,
  } as never;
}

/** metadataCache stub: one CachedMetadata-like object per path. */
function stubApp(caches: Record<string, unknown>): App {
  return {
    vault: {},
    metadataCache: {
      getCache: (path: string) => caches[path] ?? null,
    },
  } as unknown as App;
}

function routerWith(files: Record<string, StubReadResult>, caches: Record<string, unknown>): VaultRouter {
  return new VaultRouter(stubApi(files), stubApp(caches));
}

function readResult(path: string, content: string, tags: string[]): StubReadResult {
  return { path, content, tags, frontmatter: {}, mtime: 1, hash: 'h' };
}

describe('has_tags and tags in the response context', () => {
  beforeEach(() => {
    ContentBufferManager.getInstance().clear();
  });

  it('dedupes the tags array of the file just read', async () => {
    const router = routerWith(
      { 'dup.md': readResult('dup.md', '#alpha one #beta-tag two #alpha three', ['#alpha', '#beta-tag', '#alpha']) },
      { 'dup.md': { tags: [{ tag: '#alpha' }, { tag: '#beta-tag' }, { tag: '#alpha' }] } }
    );

    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: 'dup.md' }
    });

    expect(response.context?.has_tags).toBe(true);
    expect(response.context?.tags).toEqual(['#alpha', '#beta-tag']);
  });

  it('reports tags for the file loaded by view.window', async () => {
    const router = routerWith(
      { 'tagged.md': readResult('tagged.md', '#inline one', ['#inline']) },
      { 'tagged.md': { tags: [{ tag: '#inline' }] } }
    );

    const response = await router.route({
      operation: 'view'
      , action: 'window'
      , params: { path: 'tagged.md' }
    });

    expect(response.context?.has_tags).toBe(true);
    expect(response.context?.tags).toEqual(['#inline']);
  });

  it('reports tags for the file created by files.create', async () => {
    const router = routerWith(
      {},
      { 'fresh.md': { tags: [{ tag: '#fresh' }] } }
    );

    const response = await router.route({
      operation: 'files'
      , action: 'create'
      , params: { path: 'fresh.md', content: '#fresh note' }
    });

    expect(response.context?.has_tags).toBe(true);
    expect(response.context?.tags).toEqual(['#fresh']);
  });

  it('describes the current file, not the previously read file', async () => {
    const router = routerWith(
      {
        'plain.md': readResult('plain.md', 'no tags here', []),
        'tagged.md': readResult('tagged.md', '#inline one', ['#inline']),
      },
      {
        'plain.md': {},
        'tagged.md': { tags: [{ tag: '#inline' }] },
      }
    );

    await router.route({ operation: 'view', action: 'read', params: { path: 'plain.md' } });
    const response = await router.route({
      operation: 'view'
      , action: 'window'
      , params: { path: 'tagged.md' }
    });

    expect(response.context?.current_file).toBe('tagged.md');
    expect(response.context?.has_tags).toBe(true);
    expect(response.context?.tags).toEqual(['#inline']);
  });

  it('is false for a current file with no tags', async () => {
    const router = routerWith(
      { 'plain.md': readResult('plain.md', 'no tags here', []) },
      { 'plain.md': {} }
    );

    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: 'plain.md' }
    });

    expect(response.context?.has_tags).toBe(false);
    expect(response.context?.tags).toEqual([]);
  });
});

describe('the tag count in the view.read suggested_next hint', () => {
  function tagSuggestion(result: unknown): string | undefined {
    const hints = generateEnhancedHints('view', 'read', { path: 'note.md' }, result);
    return hints?.suggested_next.find(s => s.reason?.includes('tags'))?.reason;
  }

  it('counts unique tags from the read result', () => {
    const reason = tagSuggestion({
      path: 'note.md'
      , content: '#alpha one #beta-tag two #alpha three'
      , tags: ['#alpha', '#beta-tag', '#alpha']
    });

    expect(reason).toBe('This file has 2 tags - explore related content');
  });

  it('counts frontmatter tags the content regex cannot see', () => {
    const reason = tagSuggestion({
      path: 'note.md'
      , content: '---\ntags: [gamma, delta]\n---\nBody with no inline tags.'
      , tags: ['#gamma', '#delta']
    });

    expect(reason).toBe('This file has 2 tags - explore related content');
  });

  it('falls back to counting tags in the text when the result carries no tags array', () => {
    const reason = tagSuggestion('#alpha #beta-tag');

    expect(reason).toBe('This file has 2 tags - explore related content');
  });
});
