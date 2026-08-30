/**
 * files fragment search. Reached through view.fragments: indexes on demand,
 * then retrieves passages through the fragment retriever.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, readPageArgs } from '../shared';
import { Debug } from '../../utils/debug';
import { contentPage, jsonSize, FRAGMENT_FETCH_CAP } from '../../utils/content-page';
import { resolveFragmentStrategy } from './helpers';

export async function handleFragments(ctx: RouterContext, params: Params): Promise<unknown> {
  // Dedicated fragment search. When `path` is supplied it scopes the search to that
  // one file. Previously it was only ever read as a fallback *query* string.
  // Naming a file then returned passages from other files, which the caller
  // could easily attribute to the file it asked about.
  const fragmentPath = paramStr(params, 'path');
  const fragmentQuery = paramStr(params, 'query') ?? fragmentPath ?? '';

  // Skip indexing if no query provided
  if (!fragmentQuery || fragmentQuery.trim().length === 0) {
    return {
      result: []
      , context: {
        operation: 'view'
        , action: 'fragments'
        , error: 'No query provided for fragment search'
      }
    };
  }

  // Validate pagination outside the try: a caller error must surface,
  // not collapse into the empty result the catch returns on retrieval
  // failures.
  const { page: fragmentPage, pageSize: fragmentBudget, limit: fragmentLimit } = readPageArgs(params, 'view.fragments');

  try {
    const indexFile = async (filePath: string): Promise<void> => {
      if (!filePath || !filePath.endsWith('.md')) return;
      try {
        const fileResponse = await ctx.api.getFile(filePath);
        let content: string;

        if (typeof fileResponse === 'string') {
          content = fileResponse;
        } else if (fileResponse && typeof fileResponse === 'object' && 'content' in fileResponse) {
          content = fileResponse.content;
        } else {
          return;
        }

        ctx.fragmentRetriever.indexDocument(`file:${filePath}`, filePath, content);
      } catch (e) {
        // Skip files that cannot be indexed
        Debug.log(`Skipping file during fragment indexing:`, e);
      }
    };

    if (fragmentPath) {
      // Scoped to one file: index just that file. Searching the vault to decide what
      // to index would be wasted work, and could fail to index the very file named.
      await indexFile(fragmentPath);
    } else {
      // Only index files that match the query to avoid indexing entire vault
      // This is a lazy indexing approach - index on demand
      const searchResults = await ctx.api.searchPaginated(fragmentQuery, 1, 20, 'combined');

      if (searchResults && searchResults.results && searchResults.results.length > 0) {
        for (const result of searchResults.results.slice(0, 20)) { // Limit to first 20 files
          await indexFile(result.path);
        }
      }
    }

    // The retriever caps what it fetches. With a limit the universe is
    // the limit itself. Without one the cap is fixed, so the reported
    // totals stay stable while the caller walks pages. A full fetch
    // means more pages may exist.
    const fetchCap = fragmentLimit ?? FRAGMENT_FETCH_CAP;

    // Search for fragments in indexed documents
    const fragmentResponse = ctx.fragmentRetriever.retrieveFragments(fragmentQuery, {
      strategy: resolveFragmentStrategy(paramStr(params, 'strategy'))
      , maxFragments: fetchCap
      , scopePath: fragmentPath
    });

    if (fragmentResponse && Array.isArray(fragmentResponse.result)) {
      const windowed = contentPage('view.fragments', fragmentResponse.result, { page: fragmentPage, pageSize: fragmentBudget, limit: fragmentLimit }, jsonSize);
      return {
        ...fragmentResponse
        , result: windowed.items
        , page: windowed.page
        , pageSize: windowed.pageSize
        , ...(fragmentLimit !== undefined ? { limit: fragmentLimit } : {})
        , totalFragments: windowed.totalItems
        , totalPages: windowed.totalPages
        , hasMore: windowed.hasMore || (fragmentLimit === undefined && fragmentResponse.result.length === fetchCap)
      };
    }

    return fragmentResponse;
  } catch (error) {
    Debug.error('Fragment search failed:', error);
    return {
      result: []
      , context: {
        operation: 'view'
        , action: 'fragments'
        , error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
