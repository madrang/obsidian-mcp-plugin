/**
 * The mermaid reference behind the MCP resource
 * obsidian://resources/syntax/mermaid. Static curated markdown.
 */

export function generateMermaidReference(): string {
  return `# Mermaid

Mermaid diagrams render inside notes. Write a fenced code block with the \`mermaid\` language. The renderer is built into the app. No plugin is needed.

\`\`\`\`md
\`\`\`mermaid
flowchart LR
    A[Note] --> B{Has links?}
    B -->|yes| C[[Linked note]]
    B -->|no| D((End))
\`\`\`
\`\`\`\`

## Check whether it is enabled

The switch is a per-vault trust flag in the app local storage, readable through the config namespace:

\`\`\`
view(action="read", path="obsidian://config/mermaid-vault-trust")
\`\`\`

- \`true\` — trusted. Diagrams render.
- \`null\` — guarded. Each diagram shows a prompt box instead of the diagram.

Withdraw or restore the trust the same way, with the edit tool on that URI. A write re-renders notes, so the change applies immediately.

## Security

The renderer starts with \`securityLevel: "strict"\`. Diagram code cannot run scripts or inject untrusted HTML. The trust prompt exists because rendering still runs the Mermaid engine over vault content. In dark themes the rendered SVG is color inverted by the app stylesheet.

## Diagram types

Common types: \`flowchart\` (\`graph\`), \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, \`erDiagram\`, \`gantt\`, \`pie\`, \`journey\`, \`mindmap\`, \`timeline\`, \`quadrantChart\`, \`gitGraph\`.

## Linkable nodes

Add a class rule to make a node link to the note of that name:

\`\`\`mermaid
graph TD
    Boot[Boot Sequence] --> Overlord[Master Overlord]
    class Boot,Overlord internal-link;
\`\`\`

Such links do not appear in Graph view. A note name with special characters goes in double quotes: \`class "special" internal-link;\`.

## Editing

- In reading view the block renders the diagram.
- In live preview the block becomes an embed. Click it to edit the diagram code. Click outside to render again.
- A syntax error in the diagram shows an error box with the parser message. Fix the code in the fence.
- An agent writes a diagram like any note content, with the edit or files tool. No special action exists.
`;
}
