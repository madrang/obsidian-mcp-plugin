# Edit Tool

The `edit` tool modifies the content of an existing file. Every `edit` action writes. To create or replace a whole file, use `files.create` instead.

Actions: `replace`, `append`, `patch`, `at_line`, `from_buffer`, `multi`.

## Write preconditions

Every `edit` action accepts `ifUnmodifiedSince` and `ifHash`.

```json
{ "action": "replace", "path": "notes/a.md", "oldText": "draft", "newText": "final", "ifHash": "9af15b336e6a9699" }
```

- Get the values from a `view.read` that returned the complete file (visible with `raw: true`). There is no way to get them without reading the content.
- `ifUnmodifiedSince`: proceed only when the file mtime (ms epoch) still equals this value.
- `ifHash`: proceed only when the file content hash still equals this value.
- On mismatch the edit is refused with `PRECONDITION_FAILED` and nothing is written. The file changed since it was read. Read it again, then retry.
- Every successful write returns the new `mtime` and `hash`. Echo the new hash as `ifHash` on the next edit to chain writes without re-reading, until someone else edits the file and breaks the chain.

## Actions

### `replace`
Find and replace text, count-guarded.

```json
{ "action": "replace", "path": "notes/a.md", "oldText": "draft", "newText": "final" }
```

- `expected` (default 1) is both the guard and the selector. Exactly one occurrence: that one is replaced. `expected: N` above 1: exactly N occurrences, all replaced.
- Any other count refuses the edit with `MATCH_COUNT_MISMATCH` and nothing is written. The error names both numbers, and the replacement content is buffered so `from_buffer` can retry.
- Check the count first: `view.grep` lists every occurrence as `path:line:column`, or count them yourself in a complete `view.read`.
- When the exact text is absent and `expected` was omitted, fuzzy matching applies: `fuzzyThreshold` (0-1, default: 0.7) sets how close the match must be, a single fuzzy match replaces that line, and multiple matches are listed with line numbers instead of written. An explicit `expected` never falls back to fuzzy — it refuses.

### `append`
Add content to the end of a file.

```json
{ "action": "append", "path": "notes/log.md", "content": "\nNew entry" }
```

### `patch`
Modify a structural part of a note: a heading, a block, or frontmatter.

```json
{ "action": "patch", "path": "a.md", "targetType": "heading", "target": "Tasks", "operation": "append", "content": "- [ ] New task" }
```

- `targetType`: `heading` (use `::` for nesting, for example "Projects::Active"), `block` (by block ID), or `frontmatter` (a field name).
- `operation`: `append` (add after), `prepend` (add before), or `replace`.

### `at_line`
Insert content at a line number.

```json
{ "action": "at_line", "path": "a.md", "lineNumber": 10, "mode": "before", "content": "new line" }
```

`mode`: `before`, `after`, or `replace`. Line numbers are absolute: `view.read` shows them.

### `from_buffer`
Retry with the content buffered by a failed `replace` call.

```json
{ "action": "from_buffer", "path": "a.md" }
```

### `multi`
Apply several exact find-and-replace pairs in one write.

```json
{ "action": "multi", "path": "notes/a.md", "edits": [
  { "oldText": "draft", "newText": "final" },
  { "oldText": "TODO", "newText": "DONE" }
] }
```

- Exact substring matching only. Each pair replaces the first occurrence, like `replace` with `fuzzyThreshold: 1.0`. For fuzzy matching, use `replace` per pair.
- Pairs apply in order: pair 2 sees the result of pair 1.
- Every pair is verified against the evolving content before anything is written. On any mismatch the whole batch is refused, nothing is written, and the error names the failing pair.
- At most 100 pairs per call (the batch size limit).
- Accepts the write preconditions and returns the new `mtime` and `hash` like every edit action.
