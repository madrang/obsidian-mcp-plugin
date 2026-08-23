/**
 * The view tool: reads (window, active, folder, read, search, fragments).
 * Registers itself into the tool registry at import time.
 */
import { registerOperation } from '../tool-registry';
import { executeFilesOperation } from '../../semantic/operations/files';
import { executeViewOperation } from '../../semantic/operations/view';

registerOperation({
  name: 'view'
  , title: 'View Content'
  , descriptionLines: [
    '👁️ View, read, and search vault content. Every action is a read.'
    , ''
    , '## Actions'
    , { when: 'view.window', text: '- `window` — Show about 20 lines around a line number, or around the first `searchText` match when `lineNumber` is omitted.' }
    , { when: 'view.lines', text: '- `lines` — Read an exact line range.' }
    , { when: 'view.active', text: '- `active` — Show the file that is open in the editor.' }
    , { when: 'view.folder', text: '- `folder` — List the files of the folder at `path`. Omit `path` for the vault root. The listing walks the whole subtree. Filter it with a `pattern` glob, for example `*.md`.' }
    , { when: 'view.read', text: '- `read` — Read a file, whole up to a size budget and paged beyond. With `query`, fragments come back instead. An image read returns the image itself.' }
    , { when: 'view.read', text: '  A complete `read` returns the stats of the file: `mtime`, content `hash`, line count, visible with `raw: true`. Pass them back as `ifUnmodifiedSince` or `ifHash` on `edit` writes. Partial reads carry neither value.' }
    , { when: 'view.search', text: '- `search` — Search the vault for words, phrases, and regular expressions.' }
    , { when: 'view.search', text: '  Hits rank by TF-IDF. Each hit is one note: path, snippet, score. The index keeps words of three letters or more. Shorter query words match nothing.' }
    , { when: 'view.fragments', text: '- `fragments` — Get the matching passages from one file (`path`), or from the files that match a `query`. One of the two is required.' }
    , { when: 'view.grep', text: '- `grep` — Scan with a regular expression. Every match is a path, a 1-based line, a 1-based column, and the matching line.' }
  ]
  , actions: ['window', 'lines', 'active', 'folder', 'read', 'search', 'fragments', 'grep']
  , requiredParams: {
    window: ['path']
    , lines: ['path', 'startLine', 'endLine']
    , read: ['path']
    , search: ['query']
    , grep: ['pattern']
    // active and folder take nothing. fragments needs path OR query — not
    // expressible as a flat required list, and its handler already returns a
    // helpful error, so it stays out of the map.
  }
  , annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  }
  // folder/read/search/fragments run the shared file handlers. window and
  // active have their own handler in operations/view.ts.
  , execute: (ctx, action, params) =>
    (action === 'folder' || action === 'read' || action === 'search' || action === 'fragments')
      ? executeFilesOperation(ctx, action, params)
      : executeViewOperation(ctx, action, params)
  , parameters: {
    // The view tool overrides the shared path param: here a path can also
    // name a folder (folder action, grep subtree), not only a file.
    path: {
      type: 'string'
      , description: 'The target path relative to the vault root. A file for window, lines, read, fragments, and a single-file grep. A folder for folder, and a grep subtree. Omit it on folder for the vault root'
    }
    , searchText: {
      type: 'string'
      , description: 'The text to search for and highlight'
    }
    , lineNumber: {
      type: 'number'
      , description: 'The line number to center the view around. Omit it to center on the first `searchText` match. Without `searchText`, the center is line 1'
    }
    , windowSize: {
      type: 'number'
      , description: 'The number of lines to show'
      , default: 20
    }
    // lines action
    , startLine: {
      type: 'number'
      , description: 'lines: the first line to return (1-based, inclusive). Must be an integer with startLine <= endLine'
    }
    , endLine: {
      type: 'number'
      , description: 'lines: the last line to return (1-based, inclusive). endLine past the end of the file clamps to the file length; a startLine past the end errors as a stale address'
    }
    // read action
    , page: {
      type: 'number'
      , description: 'The page number for paginated results, default 1 (folder, search). For the read action: the page of a large file to read. Pages are 50000 characters'
    }
    , query: {
      type: 'string'
      , description: 'The search query (search) or the fragment query (read, fragments). Supports operators (file:, path:, content:, tag:), OR/AND, "quoted phrases", and /regex/. file: matches the file name, path: matches the file path, content: matches the note body, tag: matches tags. Matching is case-insensitive'
    }
    , strategy: {
      type: 'string'
      , enum: ['auto', 'adaptive', 'proximity', 'structure', 'semantic', 'filename', 'content', 'combined']
      , description: 'The retrieval strategy (default: auto). For read and fragments: adaptive (passages ranked by term frequency), proximity (passages where the query terms sit close together), or structure (passages cut on note headings and paragraphs). For search: filename, content, or combined (both). "semantic" is a deprecated alias of "structure"'
    }
    , maxFragments: {
      type: 'number'
      , description: 'The maximum number of fragments to return (default: 5)'
    }
    , returnFullFile: {
      type: 'boolean'
      , description: 'read: return the entire file verbatim, regardless of size. This is an explicit large-context override. The default budget is 50000 characters'
    }
    // search action
    , pageSize: {
      type: 'number'
      , description: 'The number of results per page (default: 10)'
    }
    , ranked: {
      type: 'boolean'
      , description: 'Use TF-IDF relevance scoring (default: auto-detect from the query type)'
    }
    , includeSnippets: {
      type: 'boolean'
      , description: 'Extract contextual snippets around the matches (default: true)'
    }
    , snippetLength: {
      type: 'number'
      , description: 'The maximum snippet length in characters (default: 300)'
    }
    , includeContent: {
      type: 'boolean'
      , description: 'Include the full file content in the search results, so each hit can be judged without a follow-up read (default: false)'
    }
    // grep + folder action
    , pattern: {
      type: 'string'
      , description: 'grep: a regular expression (plain JavaScript syntax, no delimiters, case-sensitive). Scope it with `path` (one file or a folder subtree). Every match comes back as path, 1-based line, 1-based column, and the matching line. folder: a glob that filters the listing against each vault-relative path. `*` stays in one folder. `docs/*.md` matches only direct children of `docs`. `**` crosses folders. A pattern without `/`, for example `*.md`, matches the file name at any depth. Matching is case-sensitive'
    }
    , maxResults: {
      type: 'number'
      , description: 'grep: the maximum number of matches to return (default: 200). A truncated result sets truncated: true'
    }
  }
});
