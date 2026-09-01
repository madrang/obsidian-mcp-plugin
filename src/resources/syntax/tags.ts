/**
 * The tags reference behind the MCP resource
 * obsidian://resources/syntax/tags. Static curated markdown.
 */

export function generateTagsReference(): string {
  return `# Tags

Type a hash symbol followed by a keyword, for example \`#meeting\`. Tags can also live in the \`tags\` frontmatter property, as a list:

\`\`\`yaml
---
tags:
  - recipe
  - cooking
---
\`\`\`

## Tag format

Allowed characters: letters and numbers, underscore and hyphen, forward slash for nesting, and common Unicode characters including emojis.

Rules:

- A tag needs at least one non-numeric character. \`#1984\` is not a valid tag. \`#y1984\` is.
- Tags cannot contain blank spaces. Use \`#camelCase\`, \`#PascalCase\`, \`#snake_case\`, or \`#kebab-case\`.
- Tags are case-insensitive. \`#tag\` and \`#TAG\` are the same tag.

## Nested tags

A forward slash creates a hierarchy: \`#inbox/to-read\`, \`#inbox/processing\`. Nested tags work across the app:

- In search, \`tag:#inbox\` matches \`#inbox\` and every nested tag below it.
- In the Tags view, nested tags show under their parent.
- In Bases, \`file.hasTag("a")\` matches \`#a\` and \`#a/b\`.

## Find notes by tag

- Click a tag in a note to search for it.
- Use the \`tag:\` operator in search, for example \`tag:#meeting\`.
- Open the Tags view with the command Tags: Show tags, then select a tag. The view lists every tag with its note count, sorted by name or frequency, as a tree or a flat list.

## Tools that read tags

- \`view(action="search", query="tag:#meeting")\` finds tagged notes. See \`obsidian://resources/syntax/search\`.
- \`graph(action="tag-analysis")\` shows one note's tags and the files that share them. \`graph(action="shared-tags")\` compares two files. See \`obsidian://resources/graph\`.
- Bases filter with \`file.hasTag()\`. See \`obsidian://resources/syntax/bases\`.
`;
}
