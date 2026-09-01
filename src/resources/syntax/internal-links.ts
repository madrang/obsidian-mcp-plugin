/**
 * The internal links reference behind the MCP resource
 * obsidian://resources/syntax/internal-links. Static curated markdown.
 */

export function generateInternalLinksReference(): string {
  return `# Internal links

Two equivalent formats:

\`\`\`md
[[Three laws of motion]]                            wikilink
[Three laws of motion](Three%20laws%20of%20motion)  markdown link
\`\`\`

- Include the folder path from the vault root for notes in folders. Use forward slashes, also on Windows.
- A link to a note that does not exist yet creates the note at that folder path.
- Links to files that are not notes need the extension, for example \`[[Figure 1.png]]\`.
- URL-encode blank spaces as \`%20\` in the markdown format, or use angle brackets: \`[Note](<My Note.md>)\`.
- A name that contains \`#\`, \`|\`, \`^\`, \`:\`, \`%%\`, \`[[\`, or \`\`]]\`\` can break links. Do not use these characters in note names.

## Link format settings, and how to check them

Two app settings govern the links Obsidian creates for you. Both are readable and writable through the config namespace:

- \`obsidian://config/useMarkdownLinks\` — \`false\` means wikilinks, \`true\` means markdown links.
- \`obsidian://config/newLinkFormat\` — \`shortest\`, \`longest\`, or \`absolute\`.

To confirm this vault writes absolute paths, read:

\`\`\`
view(action="read", path="obsidian://config/newLinkFormat")
\`\`\`

The answer must be \`"absolute"\`. To set it, edit the same URI to \`"absolute"\`. The setting governs the links the app generates, not resolution: notes resolve every format regardless.

## Link to a heading

\`\`\`md
[[#Preview a linked file]]                       heading in the same note
[[About Obsidian#Links]]                         heading in another note
[[Help#Questions#Report bugs]]                   one # per subheading level
\`\`\`

## Link to a block

A block is a unit of text: a paragraph, a quotation, or a list item. Add \`#^\` and a block identifier: \`[[2023-01-01#^37066d]]\`. Placement rules:

- Simple paragraph: a blank space and \`^id\` at the end of the line.
- Structured block (list, quotation, callout, table): the \`^id\` on its own line, with a blank line before and after.
- One list item: the \`^id\` can sit directly on the bullet line.
- Links into parts of quotations, callouts, and tables are not supported.

Identifiers contain Latin letters, numbers, and dashes only. Block references are Obsidian-specific and do not work outside Obsidian.

## Display text and aliases

\`\`\`md
[[Example|Custom name]]        shows "Custom name"
\`\`\`

An alias is a durable alternative name for a note, in the frontmatter:

\`\`\`yaml
---
aliases:
  - PIOSEE
  - Decision Model
---
\`\`\`

Selecting an alias in the link suggestions writes the note path with the alias as display text. Unlinked mentions of aliases surface in the backlinks view.

## Embeds

Add \`!\` in front of a link to render the target inline. The embed stays in sync with the source.

\`\`\`md
![[Note]]                  a whole note
![[Note#Heading]]          a section
![[Note#^block-id]]        a block
![[image.png|640x480]]     an image, width x height
![[image.png|100]]         width only, height scales
![[audio.ogg]]             an audio player
![[doc.pdf]]               a PDF viewer
![[doc.pdf#page=3]]        a PDF page
![[canvas.canvas]]         a canvas, shapes only
\`\`\`

## Backlinks and outgoing links

- The Backlinks view shows linked mentions (notes that link to the active note) and unlinked mentions (plain text that matches the note name or an alias).
- The Outgoing links view shows the reverse: every link in the note, plus text that could become links.
- Both accept the search syntax as a filter. See \`obsidian://resources/syntax/search\`.
`;
}
