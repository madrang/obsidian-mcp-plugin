/**
 * The canvas reference behind the MCP resource
 * obsidian://resources/syntax/canvas. Static curated markdown.
 */

export function generateCanvasReference(): string {
  return `# Canvas

Canvas is a core plugin for visual note-taking: an infinite 2D space to lay out notes, attachments, and web pages. Obsidian saves each canvas as a \`.canvas\` file in the open JSON Canvas format. Search covers canvas content the same way as notes.

## The JSON Canvas format

Version 1.0, MIT licensed, documented at jsoncanvas.org. The top level holds two optional arrays, \`nodes\` and \`edges\`:

\`\`\`json
{
  "nodes": [
    { "id": "a", "type": "text", "x": 0, "y": 0, "width": 250, "height": 60,
      "text": "First card", "color": "4" },
    { "id": "b", "type": "file", "x": 400, "y": 0, "width": 400, "height": 200,
      "file": "Projects/Overview.md", "subpath": "#Structure" }
  ],
  "edges": [
    { "id": "e1", "fromNode": "a", "fromSide": "right", "toNode": "b",
      "toSide": "left", "toEnd": "arrow", "label": "documents" }
  ]
}
\`\`\`

Nodes sit in the array in ascending z-index order: the first renders below all others.

## Node attributes

Every node has \`id\`, \`type\`, \`x\`, \`y\`, \`width\`, \`height\` (integers in pixels), and an optional \`color\`.

| \`type\` | Extra attributes | Holds |
| --- | --- | --- |
| \`text\` | \`text\` (required) | Plain text with markdown syntax |
| \`file\` | \`file\` (required), \`subpath\` (optional) | A vault file path. The subpath links to a heading or block and starts with \`#\` |
| \`link\` | \`url\` (required) | A web page |
| \`group\` | \`label\`, \`background\`, \`backgroundStyle\` (all optional) | A visual container for other nodes |

\`backgroundStyle\` accepts \`cover\`, \`ratio\`, or \`repeat\`.

## Edge attributes

Required: \`id\`, \`fromNode\`, \`toNode\`. Optional: \`fromSide\` and \`toSide\` (\`top\`, \`right\`, \`bottom\`, \`left\`), \`fromEnd\` and \`toEnd\` (\`none\` or \`arrow\`), \`color\`, \`label\`.

## Colors

A hex value such as \`"#FF0000"\`, or one of six presets: \`"1"\` red, \`"2"\` orange, \`"3"\` yellow, \`"4"\` green, \`"5"\` cyan, \`"6"\` purple.

## Working with canvases

- Create one with the command Canvas: Create new canvas, or right-click a folder and select New canvas.
- Double-click the canvas for a text card. Drag notes from the file explorer for note cards. Drag media for media cards. Right-click for web page cards.
- Text cards support markdown but stay invisible to Backlinks. Convert a card to a file to make it linkable.
- Hover a card edge until a filled circle appears, then drag to another card to connect. Double-click a line to label it.
- Embed a canvas in a note with \`![[My canvas.canvas]]\`. The embed shows shapes, not card text.

## Agents and .canvas files

The file is plain JSON with the \`.canvas\` extension. An agent reads and writes it through the normal view and files tools, like any note. Prefer note cards over text cards for durable content: text cards stay invisible to Backlinks and to most searches.
`;
}
