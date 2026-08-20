# Bases Tool

The `bases` tool works with Obsidian Bases: `.base` files that define database-like views over the notes in the vault.

Actions: `list`, `read`, `query`, `export`. To create a base, use `files.create` with `format: "base"`.

Bases use YAML with expression-based filters, for example `status == "active"` and `file.hasTag("project")`.

## Actions

### `list`
Show all `.base` files in the vault.

```json
{ "action": "list" }
```

### `read`
Get the YAML configuration of a base.

```json
{ "action": "read", "path": "views/projects.base" }
```

### `query`
Execute filters on vault notes, optionally for a named view.

```json
{ "action": "query", "path": "views/projects.base", "viewName": "Active" }
```

Optional parameters: `filters` (property, operator, value), `sort`, `pagination`, `properties`, and `includeContent` to include note content in the results.

### `export`
Export a base as CSV, JSON, or Markdown.

```json
{ "action": "export", "path": "views/projects.base", "format": "csv" }
```

`dateFormat` controls how dates render (for example `YYYY-MM-DD`).

## Creating a base

Bases are created through the `files` tool so that creation shares one path with every other file write:

```json
{
  "action": "create",
  "path": "views/projects.base",
  "format": "base",
  "content": {
    "source": "notes",
    "properties": ["status", "due"],
    "views": [{ "type": "table", "name": "Active" }]
  }
}
```

The configuration is validated against the Bases schema before anything is written.
