/**
 * The markdown syntax reference behind the MCP resource
 * obsidian://resources/syntax/markdown. Static curated markdown.
 */

export function generateMarkdownSyntaxReference(): string {
  return `# Markdown

Obsidian supports CommonMark plus GitHub Flavored Markdown plus LaTeX, and its own extensions. The extensions that matter are below.

## Wikilinks

\`\`\`md
[[Note Name]]                       link to a note
[[Note Name|Display Text]]          link with custom display text
[[Note Name#Heading]]               link to a heading in a note
[[Note Name#Heading#Subheading]]    one # per subheading level
[[Note Name#^block-id]]             link to a block
[[#Heading]]                        link to a heading in the same note
\`\`\`

- Use full paths from the vault root for cross-folder links.
- Markdown-format links work too: \`[Display text](Projects/Note.md)\`. URL-encode blank spaces as \`%20\` in that format.
- Links to files that are not notes need the file extension: \`[[Figure 1.png]]\`.
- Avoid these characters in note names, because they break links: \`#\`, \`|\`, \`^\`, \`:\`, \`%%\`, \`[[\`, \`]]\`.
- Typing \`[[##\` searches headings across the vault. Typing \`[[^^\` searches blocks.

## External links and images

\`\`\`md
[Obsidian Help](https://obsidian.md/help)                  external link
[Note](obsidian://open?vault=MainVault&file=My%20Note.md)  Obsidian URI to a note in another vault
![Image](https://example.com/photo.jpg)                    external image
![Image|100x145](https://example.com/photo.jpg)            sized to width x height
![](https://www.youtube.com/watch?v=NnTvZWp5Q7o)           embeds a YouTube player
<iframe src="https://example.com"></iframe>                embeds a web page (some sites refuse)
\`\`\`

## Highlights, strikethrough, comments, footnotes, task lists

\`\`\`md
==highlighted==              yellow highlight
~~struck out~~
%%hidden comment%%           visible only in source, not rendered
- [ ] todo item
- [x] done item              any character inside the brackets marks the task
[^1]                         footnote reference. Define it with [^1]: text
^[An inline footnote.]       renders in Reading view only
---                          horizontal rule (also *** or ___)
\`\`\`

## Code

Text inside \`backticks\` renders as inline code. Use double backticks when the code itself contains a backtick. Fenced code blocks use three or more backticks or tildes. Add a language code for syntax highlighting, for example \`\`\`js. To nest code blocks, give the outer fence more characters than the inner fence, or use the other fence character.

## Tables

- Add colons to the header separator to align a column: \`---:\` right, \`:---\` left, \`:---:\` center.
- Escape a pipe inside a cell with \`\\|\`, for example an aliased wikilink: \`[[Note\\|Alias]]\`.
- Inline markdown renders in cells: bold, italic, code, wikilinks.
- The header separator needs at least two hyphens per column. The outer pipes are optional.

## Math

LaTeX math renders via MathJax. Inline with \`$...$\`, block with \`$$...$$\`. Use \`\\text{...}\` for multi-letter words so they do not render as italic variables.

## Line breaks and escaping

- A single Enter continues the same paragraph. End a line with two spaces, or press Shift+Enter, for a line break inside a paragraph.
- Prefix a formatting character with \`\\\` to show it literally: \`\\*\`, \`\\_\`, \`\\#\`, \\\`\\|\\\`, \`\\~\`. Escape the period in \`1\\.\` to stop an automatic numbered list.

## HTML support, sanitized

Obsidian sanitizes HTML: it blocks script tags and similar, but supports common styling tags. Gotchas:

- Markdown does not render inside HTML blocks. Bold markers inside a div stay literal.
- HTML blocks cannot contain blank lines. A blank line ends the block.
- Useful: \`<u>underlined</u>\`, \`<span style="...">\`, \`<!-- comment -->\`, \`<br>\`.
- Prefer markdown tables over raw HTML tables.

## Deeper references

More resources live beside this one: \`obsidian://resources/syntax/internal-links\`, \`syntax/callouts\`, \`syntax/tags\`, \`syntax/properties\`, \`syntax/mermaid\`, and \`syntax/bases\`.
`;
}
