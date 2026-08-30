/**
 * files folder listing. Reached through view.folder: the read-side cases
 * share the files handlers, and the view definition delegates here.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, readPageArgs } from '../shared';
import { contentPage, jsonSize } from '../../utils/content-page';
import { FOLDER_FETCH_ALL } from './helpers';

export async function handleFolder(ctx: RouterContext, params: Params): Promise<unknown> {
  // `path` names the folder to list. "/" means the vault root.
  const dirParam = paramStr(params, 'path');
  const directory = dirParam === '/' ? undefined : dirParam;
  // A glob filter. Blank means absent.
  const pattern = paramStr(params, 'pattern')?.trim() || undefined;

  // Use paginated list if page parameters are provided, or when a
  // pattern filters the listing: the structured response then carries
  // the pattern and the next-page hint can reproduce the filtered call.
  //
  // When paginating inside a specific directory, recurse so the
  // agent sees the same universe of files as the non-paginated
  // call — page N gives the Nth slice of the recursive listing,
  // not a level-only folder enumeration. The root case is
  // already recursive (getAllLoadedFiles), so we leave
  // recursive=false there. The listFilesPaginated call routes
  // through the same path regardless.
  // Presence matters, not truthiness: a zero page, pageSize, or limit
  // is invalid input for readPageArgs, not an absent parameter.
  if (pattern !== undefined || params.page !== undefined || params.pageSize !== undefined || params.limit !== undefined) {
    const { page, pageSize, limit } = readPageArgs(params, 'view.folder');
    const recursive = directory !== undefined;
    // Fetch the full filtered universe, then window it by content
    // budget. The non-paginated path already returns the whole vault,
    // so this changes nothing about worst-case work.
    const universe = await ctx.api.listFilesPaginated(directory, 1, FOLDER_FETCH_ALL, recursive, pattern);
    const windowed = contentPage('view.folder', universe.files, { page, pageSize, limit }, jsonSize);
    return {
      ...universe
      , files: windowed.items
      , page: windowed.page
      , pageSize: windowed.pageSize
      , ...(limit !== undefined ? { limit } : {})
      , totalPages: windowed.totalPages
      , hasMore: windowed.hasMore
    };
  }

  // Fallback to simple list for backwards compatibility
  return await ctx.api.listFiles(directory);
}
