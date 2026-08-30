/**
 * files search. Reached through view.search: ranked search with snippets,
 * content-budget pagination, and a filename-only fallback on failure.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, readPageArgs } from '../shared';
import { Debug } from '../../utils/debug';
import { contentPage, jsonSize, CONTENT_PAGE_DEFAULT_SIZE } from '../../utils/content-page';
import { SEARCH_FETCH_CAP } from './helpers';

export async function handleSearch(ctx: RouterContext, params: Params): Promise<unknown> {
  // Validate query
  const queryStr = paramStr(params, 'query');
  if (!queryStr || queryStr.trim().length === 0) {
    return {
      query: queryStr || ''
      , page: 1
      , pageSize: 10
      , totalResults: 0
      , totalPages: 0
      , results: []
      , method: 'error'
      , error: 'Search query is required'
      , hint: 'Please provide a search query. Examples: "keyword", "tag:#example", "file:name.md"'
    };
  }

  // Validate pagination outside the try: a caller error must surface,
  // not trigger the filename fallback reserved for search failures.
  const { page, pageSize, limit } = readPageArgs(params, 'view.search');

  // Use advanced search with ranking and snippets
  try {
    const pageBudget = pageSize ?? CONTENT_PAGE_DEFAULT_SIZE;
    // One strategy parameter for the whole view tool. Only the search
    // strategies apply here. Anything else (a fragment strategy, auto,
    // or nothing) falls back to combined.
    const requestedStrategy = paramStr(params, 'strategy');
    const strategy: 'filename' | 'content' | 'combined' =
      requestedStrategy === 'filename' || requestedStrategy === 'content' || requestedStrategy === 'combined'
        ? requestedStrategy
        : 'combined';

    // Snippet sizing: with a limit, each item gets an even share of
    // the page budget, capped at the proven 300-char excerpt. Below
    // 100 chars per item the snippet is noise: return the matches with
    // metadata only instead.
    const snippetSpan = limit !== undefined ? Math.floor(pageBudget * 0.75 / limit) : 300;

    // Build search options from new parameters
    const searchOptions: {
      ranked?: boolean;
      includeSnippets?: boolean;
      snippetLength?: number;
      maxResults?: number;
    } = {};

    if (params.ranked !== undefined) {
      searchOptions.ranked = Boolean(params.ranked);
    }
    if (snippetSpan >= 100) {
      searchOptions.snippetLength = snippetSpan;
    } else {
      searchOptions.includeSnippets = false;
    }

    // The universe must not depend on the requested page: totals would
    // shift under the caller while walking. maxResults only caps the
    // serialized list — the search itself already scans the whole
    // vault on every call, so fetching to the cap costs nothing extra.
    const fetchCount = Math.min(limit ?? SEARCH_FETCH_CAP, SEARCH_FETCH_CAP);
    searchOptions.maxResults = fetchCount;

    const found = await ctx.api.searchPaginated(
      queryStr,
      1,
      fetchCount,
      strategy,
      searchOptions
    );

    const windowed = contentPage('view.search', found.results, { page, pageSize, limit }, jsonSize);
    return {
      ...found
      , results: windowed.items
      , page: windowed.page
      , pageSize: windowed.pageSize
      , ...(limit !== undefined ? { limit } : {})
      , totalPages: windowed.totalPages
      , pageStart: windowed.pageStart
      , pageEnd: windowed.pageEnd
      , hasMore: windowed.hasMore || (limit === undefined && found.results.length === fetchCount)
    };
  } catch (searchError) {
    Debug.error('Search failed:', searchError);

    // Try fallback with basic search strategy
    try {
      const fallbackResults = await ctx.api.searchPaginated(
        queryStr,
        1,
        10,
        'filename' // Use simple filename search as fallback
      );

      if (fallbackResults && fallbackResults.results && fallbackResults.results.length > 0) {
        return {
          ...fallbackResults
          , method: 'filename_fallback'
          , warning: 'Using filename-only search due to advanced search failure'
        };
      }
    } catch (fallbackError) {
      Debug.error('Fallback search also failed:', fallbackError);
    }

    // Return error with helpful information
    return {
      query: queryStr
      , page: 1
      , pageSize: 10
      , totalResults: 0
      , totalPages: 0
      , results: []
      , method: 'error'
      , error: searchError instanceof Error ? searchError.message : String(searchError)
      , hint: 'Try simplifying your query or check if the vault is accessible'
    };
  }
}
