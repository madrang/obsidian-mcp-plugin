/**
 * The view tool: reads (window, active, folder, read, search, fragments).
 * Registers itself into the tool registry at import time.
 */
import { registerOperation, pathParam } from '../tool-registry';
import { executeFilesOperation } from '../../semantic/operations/files';
import { executeViewOperation } from '../../semantic/operations/view';

registerOperation({
  name: 'view',
  title: 'View Content',
  descriptionLines: [
    '👁️ View, read, and search vault content. Every action is a read. All of them work in read-only mode.',
    '',
    '## Actions',
    { when: 'view.window', text: '- `window` — show about 20 lines around a point.' },
    { when: 'view.lines', text: '- `lines` — read an exact line range. Give `startLine` and `endLine`, 1-based and inclusive. What you ask for is what you get.' },
    { when: 'view.active', text: '- `active` — show the file that is open in the editor.' },
    { when: 'view.folder', text: '- `folder` — list the files in a folder. The listing walks the whole subtree, not one level.' },
    { when: 'view.read', text: '- `read` — read a file. Whole when it fits the size budget. Paged for a large file. With `query`, read returns fragments instead. Reading an image returns the image itself.' },
    { when: 'view.search', text: '- `search` — search the vault. Supports operators (`file:`, `path:`, `content:`, `tag:`), OR/AND, "quoted phrases", and `/regex/`.' },
    { when: 'view.fragments', text: '- `fragments` — get the matching passages from one file, or from the files that match the query.' },
    { when: 'view.grep', text: '- `grep` — scan with a regular expression. Every match is a path, a 1-based line, a 1-based column, and the matching line.' },
    '',
    '## Guidance',
    { when: 'view.read', text: '- A complete `read` returns the stats of the file: `mtime`, content `hash`, line count. Pass them back as `ifUnmodifiedSince` or `ifHash` on `edit` writes. Partial reads carry neither value.' },
    { when: 'view.search', text: '- `search` matches words, not meaning. It misses notes that use different words for the topic. The scores are term frequency. A low score does not mean unimportant. Do not prune results on score alone. Run a few broad scans. Then follow links from the hits with `graph.neighbors`.' },
    { when: 'view.grep', text: '- Use `grep` to count and locate occurrences. Then pass the count as `expected` to an `edit.replace`.' }
  ],
  actions: ['window', 'lines', 'active', 'folder', 'read', 'search', 'fragments', 'grep'],
  requiredParams: {
    window: ['path'],
    lines: ['path', 'startLine', 'endLine'],
    read: ['path'],
    search: ['query'],
    grep: ['pattern']
    // active and folder take nothing. fragments needs path OR query — not
    // expressible as a flat required list, and its handler already returns a
    // helpful error, so it stays out of the map.
  },
  annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  },
  // folder/read/search/fragments run the shared file handlers. window and
  // active have their own handler in operations/view.ts.
  execute: (ctx, action, params) =>
    (action === 'folder' || action === 'read' || action === 'search' || action === 'fragments')
      ? executeFilesOperation(ctx, action, params)
      : executeViewOperation(ctx, action, params),
  parameters: {
    ...pathParam,
    directory: {
      type: 'string',
      description: 'The directory path for the folder action'
    },
    searchText: {
      type: 'string',
      description: 'The text to search for and highlight'
    },
    lineNumber: {
      type: 'number',
      description: 'The line number to center the view around'
    },
    windowSize: {
      type: 'number',
      description: 'The number of lines to show',
      default: 20
    },
    // lines action
    startLine: {
      type: 'number',
      description: 'lines: the first line to return (1-based, inclusive). Must be an integer with startLine <= endLine'
    },
    endLine: {
      type: 'number',
      description: 'lines: the last line to return (1-based, inclusive). endLine past the end of the file clamps to the file length; a startLine past the end errors as a stale address'
    },
    // read action
    page: {
      type: 'number',
      description: 'The page number for paginated results (folder, search). For the read action: the page of a large file to read'
    },
    query: {
      type: 'string',
      description: 'The search query (search) or the fragment query (read). Supports operators (file:, path:, content:, tag:), OR/AND, "quoted phrases", and /regex/'
    },
    strategy: {
      type: 'string',
      enum: ['auto', 'adaptive', 'proximity', 'structure', 'semantic', 'filename', 'content', 'combined'],
      description: 'The retrieval strategy (default: auto). For read and fragments: adaptive, proximity, or structure. For search: filename, content, or combined. "semantic" is a deprecated alias of "structure"'
    },
    maxFragments: {
      type: 'number',
      description: 'The maximum number of fragments to return (default: 5)'
    },
    returnFullFile: {
      type: 'boolean',
      description: 'read: return the entire file verbatim, regardless of size. This is an explicit large-context override'
    },
    // search action
    pageSize: {
      type: 'number',
      description: 'The number of results per page'
    },
    ranked: {
      type: 'boolean',
      description: 'Use TF-IDF relevance scoring (default: auto-detect from the query type)'
    },
    includeSnippets: {
      type: 'boolean',
      description: 'Extract contextual snippets around the matches (default: true)'
    },
    snippetLength: {
      type: 'number',
      description: 'The maximum snippet length in characters (default: 300)'
    },
    includeContent: {
      type: 'boolean',
      description: 'Include the file content in the search results (slower but more thorough)'
    },
    // grep action
    pattern: {
      type: 'string',
      description: 'grep: a regular expression (plain JavaScript syntax, no delimiters, case-sensitive). Every match comes back as path, 1-based line, 1-based column, and the matching line'
    },
    maxResults: {
      type: 'number',
      description: 'grep: the maximum number of matches to return (default: 200). A truncated result sets truncated: true'
    }
  }
});
