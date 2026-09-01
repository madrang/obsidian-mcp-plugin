/**
 * The callouts reference behind the MCP resource
 * obsidian://resources/syntax/callouts. Static curated markdown.
 */

export function generateCalloutsReference(): string {
  return `# Callouts

A callout is a blockquote with a \`[!type]\` marker on the first line. The type sets the color and the icon.

\`\`\`md
> [!info] Here is a callout title
> Here is the callout body.
> It supports **Markdown**, [[Internal links]], and ![[embeds]].
\`\`\`

## Titles

The default title is the type identifier in title case. Add text after the identifier for a custom title:

\`\`\`md
> [!tip] Callouts can have custom titles
> Like this one.
\`\`\`

Omit the body for a title-only callout.

## Foldable callouts

Add \`+\` or \`-\` directly after the type identifier. Plus expands by default. Minus collapses.

\`\`\`md
> [!faq]- Are callouts foldable?
> Yes. The content stays hidden until the reader expands it.
\`\`\`

## Nested callouts

Add more \`>\` levels:

\`\`\`md
> [!question] Outer callout
> > [!todo] Inner callout
> > > [!example] A third level
\`\`\`

## Supported types

The identifier is case-insensitive. An unsupported type falls back to \`note\`.

| Type | Aliases |
| --- | --- |
| \`note\` | — |
| \`abstract\` | \`summary\`, \`tldr\` |
| \`info\` | — |
| \`todo\` | — |
| \`tip\` | \`hint\`, \`important\` |
| \`success\` | \`check\`, \`done\` |
| \`question\` | \`help\`, \`faq\` |
| \`warning\` | \`caution\`, \`attention\` |
| \`failure\` | \`fail\`, \`missing\` |
| \`danger\` | \`error\` |
| \`bug\` | — |
| \`example\` | — |
| \`quote\` | \`cite\` |

## Customize callouts with CSS

CSS snippets can define new types or restyle the built-ins:

\`\`\`css
.callout[data-callout="custom-question-type"] {
    --callout-color: #000000;
    --callout-icon: lucide-alert-circle;
}
\`\`\`

- The \`data-callout\` attribute holds the type identifier.
- \`--callout-color\` accepts any CSS color. \`--callout-icon\` accepts a Lucide icon ID or an inline SVG.
- Standard selectors work on callout parts. Adjust the border with \`--callout-border-width\` and \`--callout-border-opacity\`.

Snippets themselves are reachable through the snippets namespace. See \`obsidian://resources/syntax/custom-css\`.
`;
}
