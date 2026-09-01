/**
 * The bases tool reference behind the MCP resource
 * obsidian://resources/bases. Static curated markdown, in the shape of
 * the Dataview reference: the content lives here, not in any vault.
 */

export function generateBasesReference(): string {
  return `# bases

Manage \`.\`base files — YAML configs that query vault notes with expression-based filters. The tool writes no file.

## Actions

- **list** — all \`.\`base files. No parameters.
- **read** — the YAML config of one base. \`path\` required.
- **query** — run a base on vault notes. \`path\` required. Optional: \`viewName\`, \`filters\`, \`sortBy\`, \`sortOrder\`, \`page\`, \`pageSize\`, \`properties\`. Add \`format\` ("csv", "json", or "markdown") and the result comes back as a formatted string. In csv and markdown, the columns come from the view \`order:\` key.

There is no \`create\`, \`view\`, or \`export\` action. Create a base with \`files.create\` and \`format: "base"\`.

## Parameters

| Param | Type | Actions | Default |
|---|---|---|---|
| path | string, required | read, query | — |
| viewName | string | query | — |
| filters | array of {property, operator, value} | query | — |
| sortBy | string | query | — |
| sortOrder | string ("asc" \\| "desc") | query | asc |
| page | number | query | 1 |
| pageSize | number | query | 20 |
| properties | array of strings | query | — |
| format | string ("csv" \\| "json" \\| "markdown") | query | — |

## Filters

Filter operators: \`equals\`, \`not_equals\`, \`contains\`, \`not_contains\`, \`starts_with\`, \`ends_with\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`, \`between\`, \`in\`, \`not_in\`, \`is_empty\`, \`is_not_empty\`.

A filter property is a frontmatter key, \`file.*\` metadata, or \`formula.NAME\`. String comparison ignores case unless the filter sets \`caseSensitive: true\`.

## Expressions

- Expressions use \`&&\` and \`||\`. YAML \`and:\` or \`or:\` keys combine them.
- Formulas use the native Bases function set, for example \`if()\`. A formula that errors, or calls an unknown function, evaluates to null.
- A formula whose YAML value is not a string fails the whole query with the key named.
- A filter that errors — malformed syntax, unknown function, blocked escape — fails the whole query with the cause and the expression.
- A filter whose arithmetic evaluates to NaN, for example date-duration math, fails the query the same way instead of returning an empty set.
- A filter on a property a note does not carry is a quiet miss: that note is excluded and the query succeeds.
- Filter value methods are bounded: \`isEmpty()\` on every type. \`contains()\`, \`containsAll()\`, \`containsAny()\` on strings and lists. \`startsWith()\` and \`endsWith()\` on strings. Any other native spelling fails the query.
- Base file filters run in list form and in single-expression form.

## Sorting

The view \`sort:\` key orders the rows. \`sortBy\` refines it, and ties keep the view order.
`;
}
