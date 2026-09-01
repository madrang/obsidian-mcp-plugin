/**
 * The search reference behind the MCP resource
 * obsidian://resources/syntax/search. Static curated markdown.
 */

export function generateSearchReference(): string {
  return `# Search

The search syntax covers note and canvas content. Each word in a term matches independently inside each file. Use quotes for an exact phrase, for example \`"star wars"\`. Escape a quote inside a phrase with a backslash.

## Boolean logic

| Term | Returns files that contain |
| --- | --- |
| \`meeting work\` | both \`meeting\` and \`work\` |
| \`meeting OR work\` | either \`meeting\` or \`work\` |
| \`meeting work OR meetup personal\` | work meetings and personal meetups |
| \`meeting (work OR meetup) personal\` | \`meeting\`, \`personal\`, and one of the group |
| \`meeting -work\` | \`meeting\` but not \`work\` |
| \`meeting -(work meetup)\` | \`meeting\` but not both |

A hyphen negates a word or group. Parentheses control priority.

Compare property values with \`<\` and \`>\` inside square brackets: \`meeting [duration:<5]\`.

## Operators

| Operator | Matches | Example |
| --- | --- | --- |
| \`file:\` | text in the file name, any file type | \`file:.jpg\` |
| \`path:\` | text in the file path | \`path:"Daily notes/2022-07"\` |
| \`content:\` | text in the file content | \`content:"happy cat"\` |
| \`match-case:\` | case-sensitive match | \`match-case:HappyCat\` |
| \`ignore-case:\` | case-insensitive match | \`ignore-case:ikea\` |
| \`tag:\` | a tag in the file | \`tag:#work\` |
| \`line:\` | at least one matching line | \`line:(mix flour)\` |
| \`block:\` | matches in the same block | \`block:(dog cat)\` |
| \`section:\` | matches in the same section | \`section:(dog cat)\` |
| \`task:\` | matches inside a task | \`task:call\` |
| \`task-todo:\` | matches in an uncompleted task | \`task-todo:call\` |
| \`task-done:\` | matches in a completed task | \`task-done:call\` |

- \`tag:#work\` matches the nested tag \`#work/meeting\` but not \`#myjob/work\`.
- \`block:\` parses the markdown of every file, so it is slower.
- Operators accept nested terms: \`task:(call OR email)\`. Negate an operator with a leading hyphen.

## Properties

| Term | Returns files where |
| --- | --- |
| \`[aliases]\` | the property exists |
| \`[aliases:Name]\` | the property has the value \`Name\` |
| \`[aliases:null]\` | the property exists but has no value |
| \`[status:Draft OR Published]\` | either value |

Property names and values accept sub-queries: parentheses, OR, quotes, regular expressions. See \`obsidian://resources/syntax/properties\`.

## Regular expressions

Surround a pattern with forward slashes. JavaScript flavor: \`/\\d{4}-\\d{2}-\\d{2}/\` matches an ISO date. Combine with operators: \`path:/\\d{4}-\\d{2}-\\d{2}/\`.

## Embed search results in a note

A \`query\` code block embeds live search results:

\`\`\`\`md
\`\`\`query
tag:#project
\`\`\`
\`\`\`\`

The results stay up to date as the vault changes.

## The MCP view tool

\`view(action="search")\` runs a word-frequency search with its own operator set (\`file:\`, \`path:\`, \`content:\`, \`tag:\`, OR and AND, quoted phrases, \`/regex/\`). The operators above belong to the app's Search pane. See \`obsidian://resources/view\`.
`;
}
