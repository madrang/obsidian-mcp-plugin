/**
 * The edit tool reference behind the MCP resource
 * obsidian://resources/edit. Static curated markdown, in the shape of
 * the Dataview reference: the content lives here, not in any vault.
 */

export function generateEditReference(): string {
  return `# edit

Content edits on one file at a time. Each action takes an \`action\` string plus action-specific parameters. Pass \`raw: true\` for raw JSON.

## Actions

- **replace** — count-guarded find and replace. The surgical edit tool. Exact matching tolerates the quote classes: typographic and ASCII apostrophes, quotes, and dashes match each other, and the write splices only the matched span. Fuzzy matching applies when the exact text is absent and \`expected\` was omitted: a single fuzzy match replaces that line, and multiple matches are listed with line numbers instead of written.
- **append** — add to the end of the file.
- **patch** — structural edit of a heading, a block, or a frontmatter field. For headings, \`target\` is the full path from the top-level H1, joined by \`::\`, for example \`H1::Section::Subsection\`. The match is case-sensitive. On a frontmatter field, \`value\` writes any type serialized as YAML, and \`operation: "remove"\` deletes the field.
- **at_line** — insert before, insert after, or replace one line. The line text rides \`newText\`. An empty \`newText\` blanks the line. Omit \`newText\` to reuse the buffered replacement.
- **multi** — several exact find and replace pairs in one write, at most 100. Pairs apply in order: pair 2 sees the result of pair 1. Every pair is verified before anything is written. On any mismatch the whole batch is refused, nothing is written, and the error names the failing pair.

## Parameters

| Param | Type | Actions | Default |
|---|---|---|---|
| path | string, required | every action | — |
| oldText | string, required | replace, multi pairs | — |
| newText | string | replace, append, patch, at_line, multi pairs | — |
| value | any type | patch, frontmatter replace only | — |
| fuzzyThreshold | number | replace | 0.7 |
| expected | number | replace | 1 |
| edits | array of {oldText, newText}, required | multi | — |
| ifUnmodifiedSince | number | every action | — |
| ifHash | string | every action | — |
| lineNumber | number | at_line | 1 |
| mode | string ("before" \\| "after" \\| "replace") | at_line | replace |
| targetType | string ("heading" \\| "block" \\| "frontmatter") | patch | — |
| target | string, required | patch | — |
| operation | string ("append" \\| "prepend" \\| "replace" \\| "remove") | patch | — |

## Rules

- Write preconditions: pass \`ifUnmodifiedSince\` (an mtime) or \`ifHash\` (a content hash) from a prior read. A mismatch fails with \`PRECONDITION_FAILED\` and nothing is written. A complete \`view.read\` supplies both values.
- \`replace\` without \`expected\` errors when \`oldText\` matches more than once (\`MATCH_COUNT_MISMATCH\`). Pass the observed count as \`expected\`.
- \`at_line\` is line-fragile: any earlier edit shifts later line numbers. Re-derive line numbers from a fresh read before each call. Prefer \`replace\`, which is substring anchored.
- The server serializes same-file edit actions, so parallel batches do not overwrite each other. Issue dependent edits sequentially anyway.
- CSS snippet content is editable through the virtual namespace: pass \`obsidian://snippets/<name>.css\` as \`path\`. Snippet writes need the plugin setting "Allow snippet editing" and refuse with \`SNIPPET_WRITE_DISABLED\` without it.
- App settings are editable as JSON text through \`obsidian://config/<key>\`. The read serves pretty-printed JSON. A write parses the text first: invalid JSON fails with \`INVALID_CONFIG_JSON\` and nothing is written. Config writes need the plugin setting "Allow config editing".
`;
}
