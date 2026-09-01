/**
 * dataview query. DQL execution with the Result-monad unwrapping, syntax
 * validation, and the workflow/hints generators that ride the response.
 */
import { PluginDetector } from '../../utils/plugin-detector';
import {
  DataviewQueryResult,
  DataviewTableRow,
  DataviewTask,
  FormattedQueryResult,
  QueryHintsResponse,
  WorkflowSuggestion,
  WorkflowResponse
} from './types';
import { toPlainArray, unwrapGroup, asDataviewAPI } from './values';

/**
 * Dataview's programmatic `query()` API collapses a grouped LIST to bare group
 * keys when nothing in the query references `rows` — the grouped items are
 * dropped from the payload entirely (unlike rendered markdown, which shows
 * them). So `LIST FROM "x" GROUP BY file.folder` comes back as just the folder
 * names, with no files. Inject a default `rows.file.link` output expression for
 * exactly that shape — a LIST with GROUP BY and no explicit output expression —
 * so the API returns proper `{ key, rows }` groups instead. Queries that already
 * name an output expression, and non-LIST / non-grouped queries, pass through
 * unchanged.
 */
export function normalizeListGroupByQuery(query: string): string {
  const trimmed = query.trimStart();
  if (!/^LIST\b/i.test(trimmed)) return query;
  if (!/\bGROUP\s+BY\b/i.test(trimmed)) return query;
  // There's no explicit output expression when a clause keyword (or the end of
  // the string) immediately follows the LIST keyword.
  const noOutputExpr = /^LIST\s+(FROM|WHERE|SORT|GROUP|FLATTEN|LIMIT)\b/i.test(trimmed)
    || /^LIST\s*$/i.test(trimmed);
  if (!noOutputExpr) return query;
  return trimmed.replace(/^LIST\b/i, 'LIST rows.file.link');
}

/**
 * Execute a Dataview query
 */
export async function executeDataviewQuery(detector: PluginDetector, query: string, format: 'dql' | 'js' = 'dql'): Promise<unknown> {
  if (!detector.isDataviewAPIReady()) {
    throw new Error('Dataview plugin is not available or not enabled');
  }

  const dataviewAPI = asDataviewAPI(detector.getDataviewAPI());

  try {
    if (format === 'dql') {
      // Execute DQL query. Dataview returns {successful: false, error}
      // for syntax/runtime errors rather than throwing — propagate that
      // status to the outer envelope so the formatter can render it.
      // Recover grouped rows for an implicit `LIST ... GROUP BY` — see
      // normalizeListGroupByQuery. The user-facing `query` echoed below stays
      // the original input; only the executed query is augmented.
      const effectiveQuery = normalizeListGroupByQuery(query);
      const result: DataviewQueryResult = await dataviewAPI.query(effectiveQuery);
      const innerSuccess = result.successful !== false;
      return {
        success: innerSuccess
        , query
        , format
        , result: formatQueryResult(result)
        , type: result.value?.type || 'unknown'
        , error: innerSuccess ? undefined : result.error
        , workflow: generateQueryWorkflow(query, result)
        , hints: generateQueryHints(query)
      };
    } else {
      // Execute JavaScript query (if needed in the future)
      throw new Error('JavaScript queries not yet implemented');
    }
  } catch (error) {
    return {
      success: false
      , query
      , format
      , error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Validate a DQL query syntax
 */
export function validateDqlQuery(detector: PluginDetector, query: string): unknown {
  if (!detector.isDataviewAPIReady()) {
    throw new Error('Dataview plugin is not available or not enabled');
  }

  try {
    // Basic query structure validation
    const trimmedQuery = query.trim();
    const queryTypes = ['LIST', 'TABLE', 'TASK', 'CALENDAR'];
    const firstWord = trimmedQuery.split(/\s+/)[0]?.toUpperCase();

    if (!firstWord || !queryTypes.includes(firstWord)) {
      return {
        valid: false
        , query
        , error: `Query must start with one of: ${queryTypes.join(', ')}`
      };
    }

    return {
      valid: true
      , query
      , queryType: firstWord
      , message: 'Query syntax appears valid'
    };
  } catch (error) {
    return {
      valid: false
      , query
      , error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Format query result for MCP response
 */
export function formatQueryResult(result: DataviewQueryResult): FormattedQueryResult | null {
  if (!result) return null;

  // Unwrap Dataview's Result monad: the typed payload lives under `.value`.
  // A failed query (`successful: false`) carries no `value`.
  const payload = result.value;
  if (!payload) return null;

  // Handle different result types
  switch (payload.type) {
    case 'list':
      // GROUP BY: keep each group as {key, rows} (rows flattened to a plain
      // array) instead of leaking the list-pair wrapper downstream (#220).
      return {
        type: 'list'
        , values: toPlainArray(payload.values).map((el: unknown) => {
          const group = unwrapGroup(el);
          return group ? { key: group.key, rows: group.rows } : el;
        })
      };
    case 'table':
      return {
        type: 'table'
        , headers: payload.headers ?? []
        , values: toPlainArray(payload.values).map((row: unknown) => {
          const tableRow = row as DataviewTableRow;
          return typeof tableRow?.array === 'function' ? tableRow.array() : row;
        })
      };
    case 'task': {
      const mapTask = (task: unknown) => {
        const dvTask = task as DataviewTask;
        return {
          text: dvTask.text
          , completed: dvTask.completed
          , line: dvTask.line
          , path: dvTask.path
        };
      };
      // GROUP BY: preserve the group wrapper and map its inner rows as tasks,
      // rather than mangling each group into an empty task (#220).
      return {
        type: 'task'
        , values: toPlainArray(payload.values).map((el: unknown) => {
          const group = unwrapGroup(el);
          return group ? { key: group.key, rows: group.rows.map(mapTask) } : mapTask(el);
        })
      };
    }
    case 'calendar':
      return {
        type: 'calendar'
        , values: toPlainArray(payload.values)
      };
    default:
      return {
        type: 'unknown'
        , data: result
      };
  }
}

/**
 * Generate workflow suggestions for query results
 */
function generateQueryWorkflow(query: string, result: DataviewQueryResult): WorkflowResponse {
  const queryType = query.trim().split(/\s+/)[0]?.toUpperCase();
  const suggestions: WorkflowSuggestion[] = [];

  // Base suggestions for all query types
  suggestions.push({
    description: 'View Dataview query reference'
    , command: 'view(action="read", path="obsidian://resources/dataview")'
    , reason: 'Learn more DQL syntax and examples'
  });

  switch (queryType) {
    case 'LIST':
      suggestions.push({
        description: 'Convert to TABLE for more details'
        , command: `dataview(action="query", query="${query.replace('LIST', 'TABLE file.size, file.mtime')}")`
        , reason: 'See file metadata alongside results'
      });
      break;
    case 'TABLE':
      suggestions.push({
        description: 'Filter results with WHERE clause'
        , command: `dataview(action="query", query="${query} WHERE file.size > 1000")`
        , reason: 'Narrow down results based on criteria'
      });
      break;
    case 'TASK':
      suggestions.push({
        description: 'Show only incomplete tasks'
        , command: `dataview(action="query", query="${query} WHERE !completed")`
        , reason: 'Focus on pending tasks'
      });
      break;
  }

  // Add sorting suggestion if not already present
  if (!query.toLowerCase().includes('sort')) {
    suggestions.push({
      description: 'Sort results by modification date'
      , command: `dataview(action="query", query="${query} SORT file.mtime DESC")`
      , reason: 'Show most recently modified files first'
    });
  }

  return {
    message: `${queryType ?? 'Unknown'} query executed successfully${result.successful === false ? ' with warnings' : ''}`
    , suggested_next: suggestions.slice(0, 3) // Limit to 3 suggestions
  };
}

/**
 * Generate query optimization hints
 */
function generateQueryHints(query: string): QueryHintsResponse {
  const hints: string[] = [];
  const queryLower = query.toLowerCase();

  // Performance hints
  if (!queryLower.includes('limit') && !queryLower.includes('where')) {
    hints.push('Consider adding LIMIT clause for large vaults to improve performance');
  }

  if (queryLower.includes('from ""') || queryLower.includes('from "."')) {
    hints.push('Querying all files can be slow - consider filtering by folder or tag');
  }

  // Syntax hints
  if (queryLower.includes('where') && !queryLower.includes('sort')) {
    hints.push('Add SORT clause to order filtered results (e.g., SORT file.mtime DESC)');
  }

  if (queryLower.includes('table') && !queryLower.includes('as ')) {
    hints.push('Use AS keyword to rename columns (e.g., file.size AS "Size (bytes)")');
  }

  // Data type hints
  if (queryLower.includes('rating') || queryLower.includes('priority')) {
    hints.push('Custom frontmatter fields like rating/priority need to be defined in your notes');
  }

  return {
    performance: hints.filter(h => h.includes('performance') || h.includes('slow'))
    , syntax: hints.filter(h => h.includes('SORT') || h.includes('AS') || h.includes('LIMIT'))
    , data: hints.filter(h => h.includes('frontmatter') || h.includes('defined'))
    , alternatives: generateAlternativeQueries(query)
  };
}

/**
 * Generate alternative query suggestions
 */
function generateAlternativeQueries(query: string): string[] {
  const alternatives: string[] = [];
  const queryType = query.trim().split(/\s+/)[0]?.toUpperCase();

  switch (queryType) {
    case 'LIST':
      alternatives.push(query.replace('LIST', 'TABLE file.size, file.mtime'));
      alternatives.push(query.replace('LIST', 'CALENDAR file.ctime'));
      break;
    case 'TABLE':
      alternatives.push(query.replace(/TABLE.*FROM/, 'LIST FROM'));
      if (!query.toLowerCase().includes('group by')) {
        alternatives.push(query + ' GROUP BY file.folder');
      }
      break;
    case 'TASK':
      alternatives.push(query.replace('TASK', 'LIST'));
      break;
  }

  return alternatives.slice(0, 2); // Limit alternatives
}
