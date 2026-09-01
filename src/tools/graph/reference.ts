/**
 * The graph tool reference behind the MCP resource
 * obsidian://resources/graph. Static curated markdown, in the shape of
 * the Dataview reference: the content lives here, not in any vault.
 */

export function generateGraphReference(): string {
  return `# graph

Read the links between notes. Start broad, then narrow. Every action is a read.

## Actions

- **neighbors** — the immediate links of a note. Start here.
- **traverse** — multi-hop exploration from \`sourcePath\`, bounded by \`maxDepth\` and \`maxNodes\`.
- **path** — how two notes connect. \`sourcePath\` and \`targetPath\` required.
- **statistics** — link metrics for one note or the whole vault. \`sourcePath\` is optional. Omit it for vault-wide statistics.
- **backlinks** — what links to a note.
- **forwardlinks** — what a note links to.
- **search-traverse** — scan and follow from \`startPath\`. Omit \`startPath\` for a vault-wide scan. Only \`searchQuery\` is required. Returns snippets per node, pruned on \`scoreThreshold\`. Use it to discover which notes matter, then read those notes.
- **advanced-traverse** — multi-query traversal. \`searchQueries\` required.
- **tag-traverse** — search and follow through tag connections. \`startPath\` and \`searchQuery\` required.
- **tag-analysis** — the tags of one note and the other files that share them. \`startPath\` required.
- **shared-tags** — the tags shared by two files. \`startPath\` and \`targetPath\` required.

## Parameters

| Param | Type | Actions | Default |
|---|---|---|---|
| sourcePath | string, required | neighbors, traverse, path, backlinks, forwardlinks. Optional on statistics | — |
| targetPath | string, required | path, shared-tags | — |
| startPath | string, required | tag-traverse, tag-analysis, shared-tags. Optional on search-traverse | — |
| searchQuery | string, required | search-traverse, tag-traverse | — |
| searchQueries | array of strings, required | advanced-traverse | — |
| maxDepth | number | traverse, search-traverse, advanced-traverse, tag-traverse | 3 |
| maxNodes | number | traverse | 100 |
| strategy | string ("breadth-first" \\| "best-first" \\| "beam-search") | advanced-traverse | — |
| beamWidth | number | advanced-traverse | — |
| maxSnippetsPerNode | number | search-traverse, tag-traverse | 2 |
| scoreThreshold | number | search-traverse, tag-traverse | 0.5 |
| filePattern | string, regex on the vault-relative path | search-traverse, advanced-traverse, tag-traverse | — |

## Rules

- Two path parameters, two roles. The six standard actions take \`sourcePath\`. The search and tag actions take \`startPath\`. A required path that is absent errors with a message that names it.
- \`strategy\` and \`beamWidth\` are accepted but reach no strategy branch: the traversal is breadth-first whatever they say. Do not rely on them.
- \`filePattern\` is wired. A note that fails the regex is never visited or expanded. Plain JavaScript syntax, case-sensitive.
- The per-node \`searchQuery\` matches plain words split on whitespace, case-insensitively, as literal substrings. Operators and regex belong to the view search query only.
- The \`graph.strategy\` enum is distinct from the \`view.strategy\` enum. Do not conflate them.
`;
}
