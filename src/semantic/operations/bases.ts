/**
 * Bases operation handler (ADR-202). Reads and runs .base files. Creation
 * is reached from the files operation with format "base", not from the
 * bases tool itself.
 */
import { RouterContext } from './router-context';
import { Params, paramStr } from './shared';
import { BaseYAML } from '../../types/bases-yaml';

export async function executeBasesOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
  switch (action) {
    case 'list':
      return await ctx.api.listBases();

    case 'read': {
      const basePath = paramStr(params, 'path');
      if (!basePath) {
        throw new Error('Path parameter is required for reading a base');
      }
      return await ctx.api.readBase(basePath);
    }

    // Reached from files.create with format='base' — the tool surface no
    // longer exposes bases.create as its own action.
    case 'create': {
      const basePath = paramStr(params, 'path');
      const config = params.content as BaseYAML | undefined;
      if (!basePath || typeof config !== 'object' || config === null) {
        throw new Error('With format "base", content must be the Bases configuration object (name, source, properties, views)');
      }
      await ctx.api.createBase(basePath, config);
      return { success: true, path: basePath };
    }

    case 'query': {
      const basePath = paramStr(params, 'path');
      if (!basePath) {
        throw new Error('Path parameter is required for querying a base');
      }
      return await ctx.api.queryBase(basePath, paramStr(params, 'viewName'));
    }

    case 'export': {
      const basePath = paramStr(params, 'path');
      const format = paramStr(params, 'format') as 'csv' | 'json' | 'markdown' | undefined;
      if (!basePath || !format) {
        throw new Error('Path and format parameters are required for exporting a base');
      }
      const exportData = await ctx.api.exportBase(basePath, format, paramStr(params, 'viewName'));
      return {
        success: true,
        data: exportData,
        format
      };
    }

    default:
      throw new Error(`Unknown bases action: ${action}`);
  }
}
