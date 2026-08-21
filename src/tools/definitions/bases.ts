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
  descriptionLines: [
    '🗃️ Bases operations. A `.base` file is a YAML config with expression-based filters, for example `status == "active" and file.hasTag("project")`.',
    '',
    '## Actions',
    { when: 'bases.list', text: '- `list` — show all `.base` files.' },
    { when: 'bases.read', text: '- `read` — get the YAML configuration.' },
    { when: 'bases.query', text: '- `query` — execute the filters on vault notes. Optionally name a view with `viewName`.' },
    { when: 'bases.export', text: '- `export` — export the results as CSV, JSON, or Markdown.' }
  ],
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
