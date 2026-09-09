/**
 * The view tool reference behind the MCP resource
 * obsidian://resources/view. Static curated markdown, in the shape of
 * the Dataview reference: the content lives here, not in any vault.
 */

export function generateViewReference(): string {
  return `# view

Reads only. Every action is a read. Each action takes an \`action\` string plus action-specific parameters. Pass \`raw: true\` for raw JSON.

## Actions

- **read** — faithful by default. Returns the byte-exact whole file up to a budget of 50000 characters. Larger files return a verbatim page 1 with absolute line bookends. Use \`page=N\` to continue and \`returnFullFile: true\` to force the whole large file. With \`query\`, read returns ranked fragments instead. Reading an image returns the image itself. A complete read returns the file \`mtime\` and content \`hash\` for write preconditions.
- **lines** — an exact inclusive 1-based range. The bounds belong to the caller. \`endLine\` past the end clamps. \`startLine\` past the end errors as a stale address. Carries no \`mtime\` or \`hash\`.
- **window** — about N lines around a line number or the first \`searchText\` match.
- **active** — the file open in the editor. No parameters.
- **folder** — list the files of the folder at \`path\`, recursive over the whole subtree. Omit \`path\` for the vault root. A \`pattern\` glob filters the listing. A pattern without \`/\` matches the file name at any depth. A pattern with \`/\` anchors to the vault root, and \`**\` matches zero or more folders. Matching is case-sensitive.
- **search** — word frequency ranking, not meaning. The index keeps words of three letters or more. A shorter word drops from the query and the other words still match. A query left with no words matches nothing. Operators: \`file:\`, \`path:\`, \`content:\`, \`tag:\`, OR and AND, quoted phrases, and \`/regex/\`.
- **fragments** — contextual passages from one file (\`path\`) or from the files matching a \`query\`. One of the two is required.
- **grep** — scan with a regular expression. Every match is a path, a 1-based line, a 1-based column, and the matching line. Plain JavaScript syntax, case-sensitive, no delimiters. Scope with \`path\`. \`maxResults\` caps the list (default 200) and \`truncated: true\` means real matches were dropped.

## Parameters

| Param | Type | Actions | Default |
|---|---|---|---|
| path | string, required or per action | window, lines, read, fragments, folder, grep scope | — |
| searchText | string | window | — |
| lineNumber | number | window | 1 |
| windowSize | number | window | 20 |
| startLine | number, required | lines | — |
| endLine | number, required | lines | — |
| page | number | paginated actions | 1 |
| pageSize | number | paginated actions | 50000 |
| limit | number | paginated actions | — |
| query | string, required | search | — |
| ranked | boolean | search | — |
| strategy | string | read, fragments, search | auto |
| returnFullFile | boolean | read | false |
| pattern | string | folder glob, grep regex | — |
| maxResults | number | grep | 200 |

## Pagination

\`pageSize\` is a character budget. Items accumulate into a page until the next would exceed it. A \`page\`, \`pageSize\`, or \`limit\` under 1, non-integer, or non-numeric errors. A page past the last returns empty items and says so, without an error. Totals stay stable while walking pages.

## Virtual namespaces

The read actions also accept virtual URIs as \`path\`:

- \`obsidian://resources/<name>\` — server-computed resources. Pass \`obsidian://resources/\` to \`folder\` to list them. Each tool also has a reference page, for example \`obsidian://resources/view\`. No write action applies to a resource URI: writes refuse with \`RESOURCE_ACTION_UNSUPPORTED\`.
- \`obsidian://snippets/<name>.css\` — a CSS snippet file. Pass \`obsidian://snippets/\` to \`folder\` to list them. Reads are open.
- \`obsidian://config/<key>\` — one app setting as pretty-printed JSON. Pass \`obsidian://config/\` to \`folder\` for a catalog of known keys with types and descriptions. Reads are open.
`;
}
