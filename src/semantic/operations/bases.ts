/**
 * Bases operation handler (ADR-202). Reads and runs .base files. Creation
 * is reached from the files operation with format "base", not from the
 * bases tool itself.
 */
import { RouterContext } from './router-context';
import { Params, paramStr, paramNum } from './shared';
import { BaseYAML } from '../../types/bases-yaml';
import { BaseQueryOptions, BaseFilter } from '../../types/bases';

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
      // Bridges that stringify untyped parameters can deliver the config
      // as its JSON text. Parse it back before validation.
      let config = params.content as BaseYAML | string | undefined;
      if (typeof config === 'string') {
        try {
          config = JSON.parse(config) as BaseYAML;
        } catch {
          config = undefined;
        }
      }
      if (!basePath || typeof config !== 'object' || config === null) {
        throw new Error('With format "base", content must be the Bases configuration object — filters, formulas, properties, and views (JSON object, or its JSON text)');
      }
      await ctx.api.createBase(basePath, config);
      return { success: true, path: basePath };
    }

    // One action covers both needs. Without `format` the caller gets the
    // structured result. With `format` the same query runs and the result
    // comes back serialized — the old export action, merged in.
    case 'query': {
      const basePath = paramStr(params, 'path');
      if (!basePath) {
        throw new Error('Path parameter is required for querying a base');
      }
      const viewName = paramStr(params, 'viewName');
      const format = paramStr(params, 'format') as 'csv' | 'json' | 'markdown' | undefined;

      // Flat surface params build the internal options object. The shape
      // follows the surface standards: page/pageSize as on view.folder,
      // sortBy/sortOrder as on files.concat.
      const sortBy = paramStr(params, 'sortBy');
      const sortOrder = paramStr(params, 'sortOrder');
      const page = paramNum(params, 'page');
      const pageSize = paramNum(params, 'pageSize');
      const options: BaseQueryOptions | undefined = (
        params.filters !== undefined
        || sortBy !== undefined
        || page !== undefined
        || pageSize !== undefined
        || params.properties !== undefined
      )
        ? {
            filters: params.filters as BaseFilter[] | undefined
            , ...(sortBy !== undefined ? { sort: { property: sortBy, order: sortOrder === 'desc' ? 'desc' : 'asc' } } : {})
            , ...((page !== undefined || pageSize !== undefined) ? { pagination: { page: page ?? 1, pageSize: pageSize ?? 20 } } : {})
            , properties: params.properties as string[] | undefined
          }
        : undefined;

      if (format) {
        const exportData = await ctx.api.exportBase(basePath, format, viewName, options);
        return {
          success: true
          , data: exportData
          , format
        };
      }
      return await ctx.api.queryBase(basePath, viewName, options);
    }

    default:
      throw new Error(`Unknown bases action: ${action}`);
  }
}
