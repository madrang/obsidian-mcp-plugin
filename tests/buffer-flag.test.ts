/**
 * buffer_available must report the live buffer state on every response —
 * including the failure response that stores the buffer. The field used to
 * read context state refreshed only on success, so the MATCH_COUNT_MISMATCH
 * response that announced "The replacement content has been buffered"
 * always carried buffer_available: false.
 */
import { App } from 'obsidian';
import { VaultRouter } from '../src/tools/router';
import { ContentBufferManager } from '../src/utils/content-buffer';
import { contentHash } from '../src/utils/content-hash';
import { StateTokenManager } from '../src/tools/state-tokens';

function stubApi(initial: string) {
  let content = initial;
  return {
    api: {
      getFile: async () => ({ path: 'note.md', content }),
      updateFile: async (_path: string, newContent: string) => {
        content = newContent;
        return { success: true, mtime: 2, hash: contentHash(newContent) };
      },
      getIgnoreManager: () => undefined,
    } as never,
  };
}

function routerWith(initial: string): VaultRouter {
  const { api } = stubApi(initial);
  const app = { vault: {} } as unknown as App;
  return new VaultRouter(api, app);
}

describe('buffer_available in the response context', () => {
  beforeEach(() => {
    ContentBufferManager.getInstance().clear();
  });

  it('is true on the mismatch response that stores the buffer', async () => {
    const router = routerWith('alpha beta alpha beta');

    const response = await router.route({
      operation: 'edit'
      , action: 'replace'
      , params: { path: 'note.md', oldText: 'alpha', newText: 'X', fuzzyThreshold: 1.0 },
    });

    expect(response.error?.code).toBe('MATCH_COUNT_MISMATCH');
    expect(response.context?.buffer_available).toBe(true);
  });

  it('is false after a successful replace stores nothing', async () => {
    const router = routerWith('one match only');

    const response = await router.route({
      operation: 'edit'
      , action: 'replace'
      , params: { path: 'note.md', oldText: 'match', newText: 'hit', fuzzyThreshold: 1.0 },
    });

    expect(response.error).toBeUndefined();
    expect(response.context?.buffer_available).toBe(false);
  });
});

describe('the can_use_buffer token after a failed replace', () => {
  beforeEach(() => {
    ContentBufferManager.getInstance().clear();
  });

  it('is false when the failure buffered nothing', () => {
    const manager = new StateTokenManager();

    manager.updateTokens('edit', 'replace', { path: 'note.md', oldText: 'a' }, null, false);

    expect(manager.hasTokensFor('can_use_buffer')).toBe(false);
  });

  it('is true when the live buffer holds a replacement', () => {
    ContentBufferManager.getInstance().store('X', undefined, { filePath: 'note.md', searchText: 'a' });
    const manager = new StateTokenManager();

    manager.updateTokens('edit', 'replace', { path: 'note.md', oldText: 'a' }, null, false);

    expect(manager.hasTokensFor('can_use_buffer')).toBe(true);
  });
});
