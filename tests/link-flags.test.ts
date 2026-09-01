/**
 * has_links and linked_files in the response context must describe the
 * current file's live link state on every action. The fields used to read
 * state tokens that only view.read refreshed, and the token source was a
 * wikilink regex over the raw text: stale on window and create responses,
 * alias text kept in the values, duplicates kept, and markdown links
 * invisible.
 */
import { App } from 'obsidian';
import { VaultRouter } from '../src/tools/router';
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

function readResult(path: string, content: string): StubReadResult {
  return { path, content, tags: [], frontmatter: {}, mtime: 1, hash: 'h' };
}

describe('has_links and linked_files in the response context', () => {
  beforeEach(() => {
    ContentBufferManager.getInstance().clear();
  });

  it('reports links for the file loaded by view.window', async () => {
    const router = routerWith(
      { 'linked.md': readResult('linked.md', 'See [[Other]]') },
      { 'linked.md': { links: [{ link: 'Other' }] } }
    );

    const response = await router.route({
      operation: 'view'
      , action: 'window'
      , params: { path: 'linked.md' }
    });

    expect(response.context?.has_links).toBe(true);
    expect(response.context?.linked_files).toEqual(['Other']);
  });

  it('dedupes repeated targets and drops the alias', async () => {
    const router = routerWith(
      { 'dup.md': readResult('dup.md', '[[Note|alias]] and [[Note]]') },
      { 'dup.md': { links: [{ link: 'Note' }, { link: 'Note' }] } }
    );

    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: 'dup.md' }
    });

    expect(response.context?.linked_files).toEqual(['Note']);
  });

  it('reports markdown links the wikilink regex cannot see', async () => {
    const router = routerWith(
      { 'md.md': readResult('md.md', 'See [the other note](other.md)') },
      { 'md.md': { links: [{ link: 'other.md' }] } }
    );

    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: 'md.md' }
    });

    expect(response.context?.has_links).toBe(true);
    expect(response.context?.linked_files).toEqual(['other.md']);
  });

  it('describes the current file, not the previously read file', async () => {
    const router = routerWith(
      {
        'plain.md': readResult('plain.md', 'no links here'),
        'linked.md': readResult('linked.md', 'See [[Other]]'),
      },
      {
        'plain.md': {},
        'linked.md': { links: [{ link: 'Other' }] },
      }
    );

    await router.route({ operation: 'view', action: 'read', params: { path: 'plain.md' } });
    const response = await router.route({
      operation: 'view'
      , action: 'window'
      , params: { path: 'linked.md' }
    });

    expect(response.context?.current_file).toBe('linked.md');
    expect(response.context?.has_links).toBe(true);
    expect(response.context?.linked_files).toEqual(['Other']);
  });

  it('is false for a current file with no links', async () => {
    const router = routerWith(
      { 'plain.md': readResult('plain.md', 'no links here') },
      { 'plain.md': {} }
    );

    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: 'plain.md' }
    });

    expect(response.context?.has_links).toBe(false);
    expect(response.context?.linked_files).toEqual([]);
  });
});
