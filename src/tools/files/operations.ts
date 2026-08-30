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
 * modules beside it; create and delete stay here, small enough to read in
 * place.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramBool, requireParamStr } from '../shared';
import { SecurityError } from '../../security';
import { handleFolder } from './folder';
import { handleRead } from './read';
import { handleFragments } from './fragments';
import { handleSearch } from './search';
import { handleMove } from './move';
import { handleCopy } from './copy';
import { handleSplit } from './split';
import { combineFiles } from './concat';

/**
 * The actions the files tool owns — every one writes. list and
 * read/search/fragments live in the view tool. Their cases below are
 * reached through those operations.
 */
export const FILES_ACTIONS = ['create', 'delete', 'move', 'copy', 'split', 'concat'] as const;

export async function executeFilesOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
  switch (action) {
    case 'folder':
      return handleFolder(ctx, params);
    case 'read':
      return handleRead(ctx, params);
    case 'fragments':
      return handleFragments(ctx, params);
    case 'create': {
      const path = requireParamStr(params, 'path', 'files.create');
      // Empty content is a legitimate "touch" — only the path is required.
      const content = paramStr(params, 'content') ?? '';
      // Overwrite turns create into an upsert. An existing file is written
      // through updateFile on purpose: overwriting IS an update, so the
      // security layer must charge the UPDATE permission, not CREATE — a
      // setup with create on and update off must not gain overwrite.
      let exists = false;
      try {
        await ctx.api.getFile(path);
        exists = true;
      } catch (error) {
        // A rejected path is not a "does not exist yet" — see the move case.
        if (error instanceof SecurityError) {
          throw error;
        }
      }
      if (exists) {
        if (paramBool(params, 'overwrite') !== true) {
          throw new Error(`File already exists: ${path}. Set overwrite=true to replace its content`);
        }
        await ctx.api.updateFile(path, content);
        return { success: true, path, overwritten: true };
      }
      return await ctx.api.createFile(path, content);
    }
    case 'delete': {
      const path = requireParamStr(params, 'path', 'files.delete');
      return await ctx.api.deleteFile(path);
    }
    case 'search':
      return handleSearch(ctx, params);
    case 'move':
      return handleMove(ctx, params);
    case 'copy':
      return handleCopy(ctx, params);
    case 'split':
      return handleSplit(ctx, params);
    case 'concat':
      return combineFiles(ctx, params);
    default:
      throw new Error(`Unknown files action: ${action}`);
  }
}
