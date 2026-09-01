/**
 * The obsidian://resources/ namespace serves through the ObsidianAPI text
 * calls, the same dispatch shape ADR-113 gave snippets and config — no
 * per-action branches. Every action that reads text reads resources; every
 * write refuses with RESOURCE_ACTION_UNSUPPORTED; write preconditions chain
 * off the resource stat.
 */
import { App } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { VaultRouter } from '../src/tools/router';
import { ResourceError, ResourceService } from '../src/resources/types';
import { RESOURCES_URI_PREFIX } from '../src/resources/registry';
import { contentHash } from '../src/utils/content-hash';

const URI = `${RESOURCES_URI_PREFIX}guide`;
const TEXT = 'alpha line\nbeta line\nalpha again';

function stubService(texts: Record<string, string>): ResourceService {
  return {
    read: (uri: string) => {
      const text = texts[uri];
      if (text === undefined) throw new ResourceError(`Unknown resource: ${uri}`);
      return { uri, mimeType: 'text/markdown', text };
    }
    , list: () => []
  };
}

function routerFor(texts: Record<string, string> = { [URI]: TEXT }) {
  const api = new ObsidianAPI({} as App);
  const router = new VaultRouter(api, {} as unknown as App, stubService(texts));
  return { api, router };
}

describe('resource URIs through the text actions', () => {
  it('view.grep scans a single resource URI', async () => {
    const { router } = routerFor();

    const response = await router.route({
      operation: 'view'
      , action: 'grep'
      , params: { path: URI, pattern: 'alpha' }
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { matches: Array<{ path: string; line: number }>; totalMatches: number };
    expect(result.totalMatches).toBe(2);
    expect(result.matches.every(m => m.path === URI)).toBe(true);
  });

  it('edit.append refuses with RESOURCE_ACTION_UNSUPPORTED', async () => {
    const { router } = routerFor();

    const response = await router.route({
      operation: 'edit'
      , action: 'append'
      , params: { path: URI, newText: 'more' }
    });

    expect((response.error as { code?: string }).code).toBe('RESOURCE_ACTION_UNSUPPORTED');
  });

  it('edit.replace refuses after the read serves the resource', async () => {
    const { router } = routerFor();

    const response = await router.route({
      operation: 'edit'
      , action: 'replace'
      , params: { path: URI, oldText: 'alpha line', newText: 'X' }
    });

    expect((response.error as { code?: string }).code).toBe('RESOURCE_ACTION_UNSUPPORTED');
  });

  it('write preconditions chain off the resource stat: a matching ifHash passes to the refusal', async () => {
    const { router } = routerFor();

    const response = await router.route({
      operation: 'edit'
      , action: 'replace'
      , params: { path: URI, oldText: 'alpha line', newText: 'X', ifHash: contentHash(TEXT) }
    });

    expect((response.error as { code?: string }).code).toBe('RESOURCE_ACTION_UNSUPPORTED');
  });

  it('an unregistered resource stat reports exists false, so a precondition names the missing file', async () => {
    const { router } = routerFor();

    const response = await router.route({
      operation: 'edit'
      , action: 'replace'
      , params: { path: `${RESOURCES_URI_PREFIX}nope`, oldText: 'a', newText: 'X', ifHash: 'h' }
    });

    expect((response.error as { code?: string }).code).toBe('PRECONDITION_FAILED');
  });

  it('an unregistered resource read fails with UNKNOWN_RESOURCE', async () => {
    const { router } = routerFor();

    const response = await router.route({
      operation: 'view'
      , action: 'read'
      , params: { path: `${RESOURCES_URI_PREFIX}nope` }
    });

    expect((response.error as { code?: string }).code).toBe('UNKNOWN_RESOURCE');
  });

  it('files.create refuses with RESOURCE_ACTION_UNSUPPORTED', async () => {
    const { router } = routerFor();

    const response = await router.route({
      operation: 'files'
      , action: 'create'
      , params: { path: `${RESOURCES_URI_PREFIX}nope`, content: 'x' }
    });

    expect((response.error as { code?: string }).code).toBe('RESOURCE_ACTION_UNSUPPORTED');
  });

});
