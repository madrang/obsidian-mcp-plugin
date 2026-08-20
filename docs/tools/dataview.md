# Dataview Tool

The `dataview` tool runs Dataview Query Language (DQL) against the vault. It is only available when the [Dataview plugin](https://blacksmithgu.github.io/obsidian-dataview/) is installed and enabled.

Actions: `query`, `list`, `metadata`, `validate`, `status`.

## Actions

### `query`
Execute a DQL query.

```json
{ "action": "query", "query": "TABLE file.size, rating FROM \"Notes\" WHERE rating > 3 SORT file.mtime DESC" }
```

Supports LIST, TABLE, TASK, and CALENDAR queries with WHERE filters, sorting, and grouping. Only DQL is supported. DataviewJS is not executed.

### `list`
Get pages with metadata and frontmatter.

```json
{ "action": "list", "source": "#project" }
```

The `source` filter accepts a folder path, a `#tag`, `[[Note Name]]` for backlinks, or an empty string for all pages.

### `metadata`
Extract the complete metadata of one page.

```json
{ "action": "metadata", "path": "notes/example.md" }
```

### `validate`
Check DQL syntax without running the query.

```json
{ "action": "validate", "query": "LIST FROM #project WHERE status = \"active\"" }
```

### `status`
Check whether the Dataview plugin is available.

```json
{ "action": "status" }
```
