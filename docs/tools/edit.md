# Edit Tool

The `edit` tool modifies the content of an existing file. Every `edit` action writes. To create or replace a whole file, use `files.create` instead.

Actions: `replace`, `append`, `patch`, `at_line`, `from_buffer`.

## Actions

### `replace`
Find and replace text with fuzzy matching.

```json
{ "action": "replace", "path": "notes/a.md", "oldText": "draft", "newText": "final" }
```

- Fuzzy matching finds `oldText` even when whitespace or casing differs slightly. `fuzzyThreshold` (0-1, default: 0.7) sets how close the match must be.
- When no exact match is found, the replacement content is buffered so `from_buffer` can retry the edit.

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
