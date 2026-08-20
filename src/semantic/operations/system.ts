/**
 * System operation handler (ADR-202). Server info, command listing,
 * workflow hints, opening files in the Obsidian app, and web fetch.
 */
import { RouterContext } from './router-context';
import { Params, requireParamStr } from './shared';

export async function executeSystemOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
  switch (action) {
    case 'info':
      return ctx.api.getServerInfo();
    case 'commands':
      return ctx.api.getCommands();
    case 'open_in_obsidian':
      return await ctx.api.openFile(requireParamStr(params, 'path', 'system.open_in_obsidian'));
    case 'hints':
      return ctx.generateWorkflowSuggestions();
    case 'fetch_web': {
      // Import fetch tool dynamically
      const { fetchTool } = await import('../../tools/fetch.js');
      return await (fetchTool.handler as unknown as (api: unknown, args: Params) => Promise<unknown>)(ctx.api, params);
    }
    default:
      throw new Error(`Unknown system action: ${action}`);
  }
}
