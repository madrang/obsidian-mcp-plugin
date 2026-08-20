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
  description: '👁️ View, read, and search content. Every view action is a read, so all of them work in read-only mode. Actions: window: show about 20 lines around a point. active: show the current editor file. folder: list the files in a folder. read: read a file, in full when it fits the size budget, in pages for a large file, or in fragments with query. Reading an image returns the image itself. search: search the vault. fragments: get the matching passages from one file, or from the files that match the query. Search supports operators (file:, path:, content:, tag:), OR/AND, "quoted phrases", and /regex/. Options include ranked=true for TF-IDF relevance scoring, strategy (filename|content|combined for search), and includeSnippets for contextual extracts. Search matches words, not meaning. It will miss notes that cover a topic in different vocabulary. Its scores are term frequency, so a low-scoring hit is not necessarily unimportant. Do not prune results on score alone. Run a few broad scans instead of many narrow ones. Then follow links from the hits with `graph.neighbors` to reach the notes that search cannot rank',
  actions: ['window', 'active', 'folder', 'read', 'search', 'fragments'],
  requiredParams: {
    window: ['path'],
    read: ['path'],
    search: ['query']
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
    }
  }
});
