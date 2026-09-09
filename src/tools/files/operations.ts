/**
 * Files operation handler (ADR-202, #199).
 *
 * Every files action writes: create, delete, move, copy, split, concat. The
 * read-side cases (folder, read, search, fragments) share these handlers.
 * The router reaches them through the view operation, and it passes itself
 * as the RouterContext, so `ctx.api` and `ctx.app` are the same instances
 * as the router's.
 *
 * This module is the dispatcher. The action bodies live in the per-action
 * modules beside it. Delete stays here, small enough to read in place.
 */
import { RouterContext } from '../router-context';
import { Params, requireParamStr } from '../shared';
import { handleFolder } from './folder';
import { handleRead } from './read';
import { handleFragments } from './fragments';
import { handleSearch } from './search';
import { handleCreate } from './create';
import { handleMove } from './move';
import { handleCopy } from './copy';
import { handleSplit } from './split';
import { executeConcat } from './concat';

export async function executeFilesOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
  switch (action) {
    case 'folder':
      return handleFolder(ctx, params);
    case 'read':
      return handleRead(ctx, params);
    case 'fragments':
      return handleFragments(ctx, params);
    case 'search':
      return handleSearch(ctx, params);
    case 'create':
      return handleCreate(ctx, params);
    case 'delete': {
      const path = requireParamStr(params, 'path', 'files.delete');
      return await ctx.api.deleteFile(path);
    }
    case 'move':
      return handleMove(ctx, params);
    case 'copy':
      return handleCopy(ctx, params);
    case 'split':
      return handleSplit(ctx, params);
    case 'concat':
      return executeConcat(ctx, params);
    default:
      throw new Error(`Unknown files action: ${action}`);
  }
}
