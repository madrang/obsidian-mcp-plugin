# Bases Tool

The `bases` tool works with Obsidian Bases: `.base` files that define database-like views over the notes in the vault.

Actions: `list`, `read`, `query`. To create a base, use `files.create` with `format: "base"`. Query with `format` covers export: the result comes back as csv, json, or markdown instead of structured data.

Filters are expression strings that use `&&` and `||`. YAML `and:` or `or:` keys combine them, for example `and: [file.hasTag("project"), 'status != "archived"']`.

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
Run a base on vault notes, optionally for a named view. Without `format`, the result is structured data: notes with properties and computed formulas, plus the total count.

Optional parameters:

- `filters` — extra filters on the results. Every filter must pass, on top of the base and view filters. Each item is `{ property, operator, value }`. The property is a frontmatter key, `file.*` metadata (`file.name`, `file.mtime`, `file.tags`), or `formula.NAME`. Operators: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `not_in`, `is_empty`, `is_not_empty`. String comparison ignores case unless `caseSensitive` is true. This is the model of the in-app filter builder.
- `sortBy` and `sortOrder` — order the results by one property, `asc` or `desc`. Default `asc`. Refines the view's own `sort:`; ties keep the view order.
- `page` and `pageSize` — return one page of the results. Defaults 1 and 20. Pages apply after the view limit. The response carries `page`, `pageSize`, and the total count.
- `properties` — keep only these properties in each note. A name matches its full key or its last segment, so `status` also keeps `file.status`.

```json
{
  "action": "query",
  "path": "views/projects.base",
  "filters": [{ "property": "status", "operator": "equals", "value": "active" }],
  "sortBy": "priority",
  "sortOrder": "desc"
}
```

### Export a query
Add `format` (`csv`, `json`, or `markdown`) to `query`. The same query runs, and the result comes back as a formatted string in the response. The tool writes no file. The old `export` action merged into `query`.

```json
{ "action": "query", "path": "views/projects.base", "format": "csv" }
```

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
