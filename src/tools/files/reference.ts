/**
 * The files tool reference behind the MCP resource
 * obsidian://resources/files. Static curated markdown, in the shape of
 * the Dataview reference: the content lives here, not in any vault.
 */

export function generateFilesReference(): string {
  return `# files

Every action on this tool writes. The read-side actions live on the view tool. Each action takes an \`action\` string plus action-specific parameters. Pass \`raw: true\` for raw JSON instead of formatted markdown.

## Actions

- **create** — new file. Raw text, or with \`format: "base"\` an Obsidian Bases view. Refuses to overwrite unless the gated \`overwrite\` flag is on.
- **delete** — remove a file. The vault trash applies when the app trash option is set.
- **move** — move, or rename in place when \`destination\` has no directory part. The extension carries over on an in-place rename without one: "note.md" to "renamed" gives "renamed.md". A destination with a directory is used exactly as given, like copy and concat. Without \`overwrite\`, an existing destination is refused. Preserves history and rewrites inbound links.
- **copy** — duplicate a file.
- **split** — one file to several, by \`splitBy\` (heading, delimiter, lines, or size).
- **concat** — many files to one, in \`paths\` order.

A tool-visibility setting can hide any action from the enum.

## Parameters

| Param | Type | Actions | Default |
|---|---|---|---|
| path | string, required | create, delete, move, copy, split, concat | — |
| content | string | create | — |
| destination | string, required | move, copy, concat | — |
| overwrite | boolean | create, move, copy, concat | false, gated |
| format | string ("base") | create | — |
| splitBy | string ("heading" \\| "delimiter" \\| "lines" \\| "size"), required | split | — |
| level | number | split | 1 |
| delimiter | string | split | --- |
| linesPerFile | number | split | 100 |
| maxSize | number | split | 10000 |
| outputPattern | string | split | {filename}-{index}{ext} |
| outputDirectory | string | split | source directory |
| paths | array of strings, required | concat | — |
| separator | string | concat | \\n\\n---\\n\\n |
| includeFilenames | boolean | concat | false |
| sortBy | string ("name" \\| "modified" \\| "created" \\| "size") | concat | — |
| sortOrder | string ("asc" \\| "desc") | concat | asc |

## Rules

- The \`overwrite\` flag is gated by a dedicated plugin setting, off by default. A flagged overwrite without the grant fails with \`OVERWRITE_DISABLED\`.
- Pagination applies where listed: \`pageSize\` is a character budget per page (default 50000), \`limit\` caps item counts, and values under 1 or non-numeric inputs error.
- Always include the \`.md\` extension on note paths.
- CSS snippet files are reachable through the virtual namespace: pass \`obsidian://snippets/<name>.css\` as \`path\` to create or delete a snippet. Snippet writes need the plugin setting "Allow snippet editing". Delete is permanent, and a delete of an enabled snippet is refused with \`SNIPPET_ENABLED\` until the snippet is disabled.
- Config keys under \`obsidian://config/<key>\` refuse create and delete with \`CONFIG_ACTION_UNSUPPORTED\`. Change config values with the edit tool.
`;
}
