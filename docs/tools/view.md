# View Tool

The `view` tool reads content from the vault. Every `view` action is a read: nothing is written, so all of them work in read-only mode.

Actions: `window`, `active`, `folder`, `read`, `search`, `fragments`.

## Actions

### `read`
Read a file.

```json
{ "action": "read", "path": "notes/example.md" }
```

- Returns the complete file content when it fits the size budget.
- A large file returns a verbatim first page with absolute line numbers. Use `page: 2`, `page: 3`, and so on to continue.
- Set `returnFullFile: true` to force the whole file regardless of size.
- Pass `query` to get matching fragments instead of the full file (see `fragments`).
- Reading an image returns the image itself.
- A read that returns the complete file also returns `mtime` and `hash` (visible with `raw: true`). Pass them back as the `edit` tool's `ifUnmodifiedSince` or `ifHash` precondition to write only when the file is unchanged since this read. Partial reads (pages, fragments) carry neither value.

### `search`
Search the vault.

```json
{ "action": "search", "query": "meeting notes" }
```

- Operators: `file:`, `path:`, `content:`, `tag:`, OR/AND, `"quoted phrases"`, `/regex/`.
- Search matches words, not meaning. It will miss notes that cover a topic in different words. A low score does not mean a note is unimportant: the scores are term frequency. Do not prune results on score alone.
- Run a few broad scans, then follow links from the hits with `graph.neighbors`.
- Options: `ranked`, `strategy` (`filename`, `content`, `combined`), `includeSnippets`, `snippetLength`, `page`, `pageSize`, `includeContent`.

### `fragments`
Get the matching passages from one file, or from the files that match the query.

```json
{ "action": "fragments", "query": "release checklist", "path": "notes/release.md" }
```

- `path` is optional: with it, the search is scoped to that one file.
- Fragment strategies (`strategy`): `adaptive` (ranked by term frequency), `proximity` (query terms close together), `structure` (cut on headings and paragraphs). `auto` picks per query. All of them match words, not meaning.
- `maxFragments` sets the number of passages (default: 5).

### `folder`
List the files in a folder.

```json
{ "action": "folder", "directory": "notes", "page": 1, "pageSize": 50 }
```

Omit `directory` for the vault root.

### `window`
Show about 20 lines around a point in a file.

```json
{ "action": "window", "path": "notes/a.md", "lineNumber": 42 }
```

With `searchText` and no `lineNumber`, the window centers on the first fuzzy match. `windowSize` sets the number of lines.

### `active`
Get the file currently open in the Obsidian editor.

```json
{ "action": "active" }
```

Fails with a clear error when no file is open.

### `grep`
Scan markdown files with a regular expression and get every match as an address.

```json
{ "action": "grep", "pattern": "TODO\\(.*\\)" }
```

- Each match is `path`, 1-based `line`, 1-based `column`, and the matching `text` — the count-first half of a count-guarded `edit.replace`.
- The pattern is a plain JavaScript regular expression: no delimiters, case-sensitive.
- Scope with `path` (one file) or `directory` (a subtree); the default is the whole vault.
- `maxResults` caps the match list (default: 200). A truncated result sets `truncated: true` — raise the cap or narrow the scope to see the rest.
