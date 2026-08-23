/**
 * Dataview operation handler (ADR-202). DQL queries through DataviewTool.
 * The handler returns a DataviewResult envelope instead of throwing on
 * missing parameters, so the tool layer can format structured errors.
 */
import { RouterContext } from './router-context';
import { Params } from './shared';
import { DataviewTool } from '../../tools/dataview-tool';

/** Result envelope for Dataview actions (structured errors, not throws). */
export interface DataviewResult {
  result?: unknown;
  error?: { code: string; message: string };
  context: {
    operation: string;
    action: string;
    query?: string;
    source?: unknown;
    path?: string;
  };
}

export async function executeDataviewOperation(ctx: RouterContext, action: string, params: Params): Promise<DataviewResult> {
  const dataviewTool = new DataviewTool(ctx.api);
  const operation = 'dataview';

  switch (action) {
    case 'status':
      return {
        result: dataviewTool.getStatus()
        , context: { operation, action }
      };
    case 'query': {
      if (!params.query) {
        return {
          error: { code: 'MISSING_PARAMETER', message: 'Query parameter is required' }
          , context: { operation, action }
        };
      }
      const dvFormat = params.format === 'js' ? 'js' : 'dql';
      const queryResult = await dataviewTool.executeQuery(params.query as string, dvFormat);
      return {
        result: queryResult
        , context: { operation, action, query: params.query as string }
      };
    }
    case 'list': {
      const listResult = await dataviewTool.listPages(params.source as string | undefined);
      return {
        result: listResult
        , context: { operation, action, source: params.source }
      };
    }
    case 'metadata': {
      if (!params.path) {
        return {
          error: { code: 'MISSING_PARAMETER', message: 'Path parameter is required' }
          , context: { operation, action }
        };
      }
      const metadataResult = await dataviewTool.getPageMetadata(params.path as string);
      return {
        result: metadataResult
        , context: { operation, action, path: params.path as string }
      };
    }
    case 'validate': {
      if (!params.query) {
        return {
          error: { code: 'MISSING_PARAMETER', message: 'Query parameter is required' }
          , context: { operation, action }
        };
      }
      const validateResult = await dataviewTool.validateQuery(params.query as string);
      return {
        result: validateResult
        , context: { operation, action, query: params.query as string }
      };
    }
    default:
      return {
        error: { code: 'INVALID_ACTION', message: `Unknown Dataview action: ${action}` }
        , context: { operation, action }
      };
  }
}
