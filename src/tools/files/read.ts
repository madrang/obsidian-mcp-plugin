/**
 * files read. The view tool reaches this handler through view.read, with
 * optional fragment retrieval and content-budget pagination.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramBool, readPageArgs } from '../shared';
import { readFileWithFragments } from '../../utils/file-reader';
import { isResourceUri } from '../../resources/registry';
import { resourceReadResult } from '../view/resource-read';
import { resolveFragmentStrategy } from './helpers';

export async function handleRead(ctx: RouterContext, params: Params): Promise<unknown> {
  const path = paramStr(params, 'path') ?? '';
  // Resource URIs serve computed text whole: pagination and fragment
  // retrieval are vault-file concepts.
  if (isResourceUri(path)) {
    return resourceReadResult(ctx, path);
  }
  const strategy = paramStr(params, 'strategy') !== undefined
    ? resolveFragmentStrategy(paramStr(params, 'strategy'))
    : undefined;
  const { page, pageSize, limit } = readPageArgs(params, 'view.read');
  return await readFileWithFragments(ctx.api, ctx.fragmentRetriever, {
    path
    , returnFullFile: paramBool(params, 'returnFullFile')
    , page
    , pageSize
    , limit
    , query: paramStr(params, 'query')
    , strategy
  });
}
