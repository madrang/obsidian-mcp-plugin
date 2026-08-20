/**
 * The dataview tool: DQL queries against the vault. Registered here like
 * every other tool. The factory exposes it only when the Dataview plugin is
 * installed and enabled.
 */
import { registerOperation, pathParam } from '../tool-registry';
import { executeDataviewOperation } from '../../semantic/operations/dataview';

registerOperation({
  name: 'dataview',
  title: 'Dataview Operations',
  description: '📊 Dataview operations. Actions: query: execute DQL queries, for example LIST FROM "folder" or TABLE field FROM #tag WHERE condition. list: get pages with metadata and frontmatter. metadata: extract the complete page metadata. validate: check DQL syntax. status: check plugin availability. Supports LIST, TABLE, TASK, and CALENDAR queries with WHERE filters, sorting, and grouping',
  actions: ['query', 'list', 'metadata', 'validate', 'status'],
  requiredParams: {
    query: ['query'],
    metadata: ['path'],
    validate: ['query']
  },
  annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  },
  execute: executeDataviewOperation,
  parameters: {
    query: {
      type: 'string',
      description: 'The DQL query string. Examples: "LIST FROM #project WHERE status = \\"active\\"", "TABLE file.size, rating FROM \\"Notes\\" WHERE rating > 3 SORT file.mtime DESC", "TASK FROM #todo WHERE !completed", "CALENDAR file.ctime FROM \\"Daily Notes\\""'
    },
    format: {
      type: 'string',
      enum: ['dql'],
      description: 'The query format (only DQL is currently supported)',
      default: 'dql'
    },
    source: {
      type: 'string',
      description: 'The source filter for pages. Examples: "folder/path" (folder), "#tag" (tag), "[[Note Name]]" (backlinks), "" (all pages)'
    },
    ...pathParam
  }
});
