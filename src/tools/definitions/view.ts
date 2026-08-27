/**
 * The view tool: reads (window, active, folder, read, search, fragments).
 * Registers itself into the tool registry at import time.
 */
import { registerOperation } from '../tool-registry';
import { executeFilesOperation } from '../operations/files';
import { executeViewOperation } from '../operations/view';

registerOperation({
  name: 'view'
  , title: 'View Content'
  , descriptionLines: [
    'View, read, and search vault content. Every action is a read.'
    , ''
    , '## Actions'
    , { when: 'view.window', text: '- `window` — Show a range of lines around a line number or a `searchText` match.' }
    , { when: 'view.lines', text: '- `lines` — Read an exact line range.' }
    , { when: 'view.active', text: '- `active` — Show the file that is open in the editor.' }
    , { when: 'view.folder', text: '- `folder` — List the files of the folder at `path`. Omit `path` for the vault root. The listing walks the whole subtree.' }
    , { when: 'view.read', text: '- `read` — Read a file, whole up to 50000 characters and paged beyond. With `query`, fragments come back instead. An image read returns the image itself.' }
    , { when: 'view.read', text: '  A complete `read` returns the stats of the file: `mtime`, content `hash`, line count, visible with `raw: true`. Pass them back as `ifUnmodifiedSince` or `ifHash` on `edit` writes. Partial reads carry neither value.' }
    , { when: 'view.search', text: '- `search` — Search the vault for words, phrases, and regular expressions.' }
    , { when: 'view.search', text: '  Hits rank by TF-IDF. Each hit is one note: path, snippet, score. The index keeps words of three letters or more. A shorter word is dropped from the query, and the other words still match. A query left with no words matches nothing.' }
    , { when: 'view.fragments', text: '- `fragments` — Get the matching passages from one file (`path`), or from the files that match a `query`. One of the two is required.' }
    , { when: 'view.grep', text: '- `grep` — Scan with a regular expression. Every match is a path, a 1-based line, a 1-based column, and the matching line. Without `path`, the scan covers the whole vault.' }
  ]
  , actions: ['window', 'lines', 'active', 'folder', 'read', 'search', 'fragments', 'grep']
  , requiredParams: {
    window: ['path']
    , lines: ['path', 'startLine', 'endLine']
    , read: ['path']
    , search: ['query']
    , grep: ['pattern']
    // active and folder take nothing. fragments needs path OR query: a flat
    // required list cannot say that, so the one-of map carries it. The
    // handler's empty-result return for a bare call masked the gap — the
    // caller saw "No fragments found", not a MISSING_PARAMETER error.
  }
  , requireAnyParams: {
    fragments: ['path', 'query']
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
      , description: 'The target path relative to the vault root. A file for window, lines, read, fragments, and a single-file grep. A folder for folder, and a grep subtree'
    }
    , searchText: {
      type: 'string'
      , description: 'The text to search for and highlight'
    }
    , lineNumber: {
      type: 'number'
      , description: 'The line number to center the view around. Omit it to center on the first `searchText` match. Without `searchText`, or when `searchText` has no match, the center is line 1'
    }
    , windowSize: {
      type: 'number'
      , description: 'The window span in lines, centered on the target line and clamped to the file bounds'
      , default: 20
    }
    // lines action
    , startLine: {
      type: 'number'
      , description: 'lines: the first line to return (1-based, inclusive). Must be an integer with startLine <= endLine'
    }
    , endLine: {
      type: 'number'
      , description: 'lines: the last line to return (1-based, inclusive). endLine past the end of the file clamps to the file length; a startLine past the end errors'
    }
    // read action
    , page: {
      type: 'number'
      , description: 'The page number for paginated results (folder, search, fragments). Folder and search responses carry the total page count. For the read action: the page of a large file to read, or with query the page of fragments. File pages are 50000 characters. A shorter page is the last'
      , default: 1
    }
    , query: {
      type: 'string'
      , description: 'The search query (search) or the fragment query (read, fragments). Supports operators (file:, path:, content:, tag:), OR/AND, "quoted phrases", and /regex/. file: matches the file name, path: matches the file path, content: matches the note body, tag: matches tags. Matching is case-insensitive'
    }
    , strategy: {
      type: 'string'
      , enum: ['auto', 'adaptive', 'proximity', 'structure', 'filename', 'content', 'combined']
      , description: 'The retrieval strategy. For read and fragments: adaptive (passages ranked by term frequency), proximity (passages where the query terms sit close together), or structure (passages cut on note headings and paragraphs). For search: filename, content, or combined (both). Auto resolves search to combined. For read and fragments, auto picks per query'
      , default: 'auto'
    }
    , returnFullFile: {
      type: 'boolean'
      , description: 'read: return the entire file verbatim, regardless of size. This is an explicit large-context override'
    }
    // search action
    , pageSize: {
      type: 'number'
      , description: 'The page content text size limit in characters. One default for every action. Items accumulate into a page until the next one would exceed the budget. For read: the content size of one file page. An invalid value (not a number, or under 1) returns an error'
      , default: 50000
    }
    , limit: {
      type: 'number'
      , description: 'The maximum number of items to return (files, search hits, fragments). Optional: omit it to fill the pageSize budget. The page can return fewer items when the budget or the result count cuts first. A value under 1 returns an error'
    }
    , ranked: {
      type: 'boolean'
      , description: 'Use TF-IDF relevance scoring (default: auto-detect from the query type)'
    }
    // grep + folder action
    , pattern: {
      type: 'string'
      , description: 'grep: a regular expression (plain JavaScript syntax, no delimiters, case-sensitive). Scope it with `path` (one file or a folder subtree). folder: a glob that filters the listing against each vault-relative path. A pattern without `/`, for example `*.md`, matches the file name at any depth. A pattern with `/` anchors to the vault root: `docs/*.md` matches only direct children of `docs`, and `**` matches zero or more folders, so `docs/**/*.md` also matches `docs/a.md`. Both matchers are case-sensitive'
    }
    , maxResults: {
      type: 'number'
      , description: 'grep: the maximum number of matches to return. A truncated result sets truncated: true'
      , default: 200
    }
  }
});
