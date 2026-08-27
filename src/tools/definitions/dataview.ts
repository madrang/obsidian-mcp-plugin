/**
 * The dataview tool: DQL queries against the vault. Registered here like
 * every other tool. The factory exposes it only when the Dataview plugin is
 * installed and enabled.
 */
import { registerOperation, pathParam } from '../tool-registry';
import { executeDataviewOperation } from '../operations/dataview';

registerOperation({
  name: 'dataview'
  , title: 'Dataview Operations'
  , descriptionLines: [
    'Query notes and metadata through the Dataview plugin. The `query` and `validate` actions take DQL.'
    , ''
    , '## Actions'
    , { when: 'dataview.query', text: '- `query` — Execute a DQL query.' }
    , { when: 'dataview.list', text: '- `list` — get pages with metadata and frontmatter.' }
    , { when: 'dataview.metadata', text: '- `metadata` — extract the complete page metadata.' }
    , { when: 'dataview.validate', text: '- `validate` — check DQL syntax.' }
    , { when: 'dataview.status', text: '- `status` — check plugin availability.' }
  ]
  , actions: ['query', 'list', 'metadata', 'validate', 'status']
  , requiredParams: {
    query: ['query']
    , metadata: ['path']
    , validate: ['query']
  }
  , annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  }
  , execute: executeDataviewOperation
  , parameters: {
    query: {
      type: 'string'
      , description: 'The DQL query string. Examples: "LIST FROM #project WHERE status = \\"active\\"", "TABLE file.size, rating FROM \\"Notes\\" WHERE rating > 3 SORT file.mtime DESC", "TASK FROM #todo WHERE !completed", "CALENDAR file.ctime FROM \\"Daily Notes\\""'
    }
    , format: {
      type: 'string'
      , enum: ['dql']
      , description: 'The query format'
      , default: 'dql'
    }
    , source: {
      type: 'string'
      , description: 'The source filter for pages (list). Examples: "folder/path" (folder), "#tag" (tag), "[[Note Name]]" (backlinks), "" or omitted (all pages)'
    }
    , ...pathParam
  }
});
