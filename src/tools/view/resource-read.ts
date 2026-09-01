/**
 * Resource URI access for the view actions read, lines, and window.
 *
 * Clients that cannot use the MCP resources/read request reach the same
 * content through normal tool actions: the router carries the registry
 * reader, and these helpers serve it with the result shapes the view
 * formatters already render.
 */
import { RouterContext } from '../router-context';
import { ResourceContent } from '../../resources/types';

/** Read one resource through the router's service. */
export function readResourceContent(ctx: RouterContext, uri: string): ResourceContent {
  if (!ctx.resources) {
    throw new Error(`Resource access is not wired on this router: ${uri}`);
  }
  return ctx.resources.read(uri);
}

/** view.read result shape for a resource: file-like content, no stats. */
export function resourceReadResult(ctx: RouterContext, uri: string): { path: string; content: string } {
  const resource = readResourceContent(ctx, uri);
  return { path: resource.uri, content: resource.text };
}
