/**
 * The bases tool: list, read, query, and export of .base files. Registers
 * itself into the tool registry at import time. Creation goes through
 * files.create with format "base".
 */
import { registerOperation } from '../tool-registry';
import { executeBasesOperation } from '../../semantic/operations/bases';

registerOperation({
  name: 'bases',
  title: 'Bases Operations',
  description: '🗃️ Bases operations. Actions: list: show all .base files. read: get the YAML configuration. query: execute filters on vault notes, optionally for a named view with viewName. export: export as CSV, JSON, or Markdown. Bases use YAML format with expression-based filters, for example status == "active" and file.hasTag("project")',
  actions: ['list', 'read', 'query', 'export'],
  requiredParams: {
    read: ['path'],
    query: ['path'],
    export: ['path', 'format']
  },
  annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  },
  execute: executeBasesOperation,
  parameters: {
    path: {
      type: 'string',
      description: 'The path to the .base file'
    },
    viewName: {
      type: 'string',
      description: 'The name of the view to run (query)'
    },
    filters: {
      type: 'array',
      items: { type: 'object' },
      description: 'An array of filter objects with property, operator, and value'
    },
    sort: {
      type: 'object',
      description: 'The sort options with property and order (asc/desc)'
    },
    pagination: {
      type: 'object',
      description: 'The pagination options with page and pageSize'
    },
    includeContent: {
      type: 'boolean',
      description: 'Include the note content in the results'
    },
    properties: {
      type: 'array',
      items: { type: 'string' },
      description: 'The specific properties to include in the results'
    },
    format: {
      type: 'string',
      enum: ['csv', 'json', 'markdown'],
      description: 'The export format'
    },
    dateFormat: {
      type: 'string',
      description: 'The date format for export (for example YYYY-MM-DD)'
    }
  }
});
