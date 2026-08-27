/**
 * The view list actions fail closed on invalid pagination. A zero,
 * negative, or non-integer page, pageSize, or limit is a caller error:
 * readPageArgs throws and no vault or index call runs. Three defect
 * classes are pinned:
 *
 * - view.folder once read the params by truthiness, so a lone 0 fell
 *   through to the legacy non-paginated listing.
 * - view.search once validated inside its try, so the throw triggered
 *   the filename fallback reserved for search backend failures.
 * - view.fragments once validated inside its try, so the throw collapsed
 *   into the empty result set the catch returns on retrieval failures.
 *
 * Strategy: a recording API counts every call. After a malformed call the
 * response must carry an error AND the counters must stay at zero.
 *
 * Stability pins: the search and fragment universes are fetched at a fixed
 * cap regardless of the requested page. A universe that grows while the
 * caller walks makes the reported totals shift under them — the fetch count
 * must be identical on page 1 and on page 3.
 */
import { App } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { VaultRouter } from '../src/tools/router';

class RecordingAPI extends ObsidianAPI {
  listFilesCalls = 0;
  paginatedListCalls = 0;
  searchCalls = 0;
  searchFetchCounts: number[] = [];
  searchResults: unknown[] = [];

  constructor() {
    super({} as App);
  }

  async listFiles(): Promise<string[]> {
    this.listFilesCalls++;
    return ['docs/readme.md'];
  }

  async listFilesPaginated(): Promise<any> {
    this.paginatedListCalls++;
    return { files: [], page: 1, pageSize: 20, totalFiles: 0, totalPages: 0 };
  }

  async searchPaginated(...args: unknown[]): Promise<any> {
    this.searchCalls++;
    this.searchFetchCounts.push(args[2] as number);
    return {
      query: 'q'
      , results: this.searchResults
      , totalResults: this.searchResults.length
      , page: 1
      , pageSize: 10
      , totalPages: 1
      , method: 'mock'
    };
  }
}

describe('view pagination guards — invalid values fail closed', () => {
  let api: RecordingAPI;
  let router: VaultRouter;

  beforeEach(() => {
    api = new RecordingAPI();
    router = new VaultRouter(api);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('folder with page=0 rejects instead of returning the legacy listing', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'folder',
      params: { page: 0 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("view.folder: 'page' must be a whole number of at least 1");
    expect(api.listFilesCalls).toBe(0);
    expect(api.paginatedListCalls).toBe(0);
  });

  test('folder with pageSize=0 rejects', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'folder',
      params: { pageSize: 0 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("view.folder: 'pageSize' must be a whole number of at least 1");
    expect(api.listFilesCalls).toBe(0);
    expect(api.paginatedListCalls).toBe(0);
  });

  test('folder with limit=0 rejects', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'folder',
      params: { limit: 0 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("view.folder: 'limit' must be a whole number of at least 1");
    expect(api.listFilesCalls).toBe(0);
    expect(api.paginatedListCalls).toBe(0);
  });

  test('folder with a non-integer page rejects', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'folder',
      params: { page: 2.5 },
    });
    expect(response.error).toBeDefined();
    expect(api.paginatedListCalls).toBe(0);
  });

  test('search with page=0 rejects and never reaches the filename fallback', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'search',
      params: { query: 'kanban', page: 0 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("view.search: 'page' must be a whole number of at least 1");
    expect(api.searchCalls).toBe(0);
  });

  test('search with a non-integer limit rejects', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'search',
      params: { query: 'kanban', limit: 1.5 },
    });
    expect(response.error).toBeDefined();
    expect(api.searchCalls).toBe(0);
  });

  test('fragments with page=0 rejects before any indexing or retrieval', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'fragments',
      params: { query: 'kanban', page: 0 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("view.fragments: 'page' must be a whole number of at least 1");
    expect(api.searchCalls).toBe(0);
  });

  test('fragments with pageSize=0 rejects', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'fragments',
      params: { query: 'kanban', pageSize: 0 },
    });
    expect(response.error).toBeDefined();
    expect(api.searchCalls).toBe(0);
  });

  test('search with valid page and pageSize still runs', async () => {
    const response: any = await router.route({
      operation: 'view',
      action: 'search',
      params: { query: 'kanban', page: 1, pageSize: 400 },
    });
    expect(response.error).toBeUndefined();
    expect(api.searchCalls).toBe(1);
  });

  test('search fetch is page-independent, so totals stay stable while walking', async () => {
    // Five hits, each serialized past the 400-char budget: one per page.
    api.searchResults = Array.from({ length: 5 }, (_, i) => ({
      path: `docs/${i}.md`
      , title: `${i}.md`
      , score: 1 - i * 0.1
      , snippet: { content: 'x'.repeat(380), lineStart: 1, lineEnd: 5, score: 1 },
    }));
    const p1: any = await router.route({
      operation: 'view',
      action: 'search',
      params: { query: 'kanban', page: 1, pageSize: 400 },
    });
    const p3: any = await router.route({
      operation: 'view',
      action: 'search',
      params: { query: 'kanban', page: 3, pageSize: 400 },
    });
    expect(p1.error).toBeUndefined();
    expect(p1.result.totalResults).toBe(5);
    expect(p3.result.totalResults).toBe(5);
    expect(p1.result.totalPages).toBe(p3.result.totalPages);
    expect(p1.result.results[0].path).toBe('docs/0.md');
    expect(p3.result.results[0].path).toBe('docs/2.md');
    // SEARCH_FETCH_CAP on both calls: the fetch no longer scales with the page.
    expect(api.searchFetchCounts).toEqual([5000, 5000]);
  });

  test('fragments fetch is page-independent, so totals stay stable while walking', async () => {
    const fragments = Array.from({ length: 5 }, (_, i) => ({
      id: `f${i}`
      , docId: `file:docs/${i}.md`
      , docPath: `docs/${i}.md`
      , content: 'x'.repeat(380)
      , score: 1 - i * 0.1
      , lineStart: 1
      , lineEnd: 5,
    }));
    const spy = jest.spyOn(router.fragmentRetriever, 'retrieveFragments')
      .mockReturnValue({ result: fragments } as any);
    const p1: any = await router.route({
      operation: 'view',
      action: 'fragments',
      params: { query: 'kanban', page: 1, pageSize: 400 },
    });
    const p3: any = await router.route({
      operation: 'view',
      action: 'fragments',
      params: { query: 'kanban', page: 3, pageSize: 400 },
    });
    expect(p1.error).toBeUndefined();
    expect(p1.result.totalFragments).toBe(5);
    expect(p3.result.totalFragments).toBe(5);
    expect(p1.result.totalPages).toBe(p3.result.totalPages);
    // FRAGMENT_FETCH_CAP on both calls: the fetch no longer scales with the page.
    expect(spy.mock.calls.map(c => (c[1] as { maxFragments: number }).maxFragments)).toEqual([500, 500]);
  });
});
