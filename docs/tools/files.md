# Files Tool

The `files` tool manages files in the vault. Every `files` action writes.

Actions: `create`, `delete`, `move`, `copy`, `split`, `concat`.

To read, list, or search, use the [`view` tool](view.md). For partial edits, use the `edit` tool.

## Actions

### `create`
Create a new file. Raw text by default.

```json
{ "action": "create", "path": "notes/new.md", "content": "# New note" }
```

- Empty `content` creates an empty file.
- Missing parent folders are created.
- If the file exists, the call fails. Set `overwrite: true` to replace the whole content. Overwriting is charged UPDATE, and requires the **Allow overwrite** setting.
- With `format: "base"`, `content` is the Bases configuration object (name, source, properties, views) and the file is created as a schema-validated Obsidian Bases view.
- With `format: "folder"`, create a directory at `path`, with any missing parents. A path that already exists is refused. `content` must be omitted or empty: a non-empty value fails the call and nothing is created.

### `delete`
Move a file to the trash.

```json
{ "action": "delete", "path": "notes/old.md" }
```

### `move`
Relocate a file, or rename it in place. One parameter covers both.

```json
{ "action": "move", "path": "notes/a.md", "destination": "archive/a.md" }
{ "action": "move", "path": "notes/a.md", "destination": "renamed" }
```

- A `destination` with a directory relocates (vault-root-relative, with or without a leading slash).
- A bare `destination` (no directory) renames in place. The file keeps its extension when the new name omits one: `renamed` becomes `renamed.md`.
- Fails if the destination exists, unless `overwrite: true`.
- Uses Obsidian's link-preserving rename, so links update.

### `copy`
Copy a file to a destination.

```json
{ "action": "copy", "path": "notes/a.md", "destination": "notes/b.md" }
```

### `split`
Split one file into several files.

```json
{ "action": "split", "path": "long.md", "splitBy": "heading", "level": 1 }
```

Split strategies: `heading` (by markdown headings, with `level`), `delimiter` (by a custom string), `lines` (by line count), `size` (by character count).

### `concat`
Join files into one, in the order of the `paths` array. Always writes: `destination` is required.

```json
{ "action": "concat", "paths": ["a.md", "b.md"], "destination": "combined.md" }
```

- Fails if the destination exists, unless `overwrite: true`.
- Options: `separator`, `includeFilenames`, `sortBy`, `sortOrder`, `overwrite`.
