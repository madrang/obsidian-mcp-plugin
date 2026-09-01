/**
 * The custom CSS reference behind the MCP resource
 * obsidian://resources/syntax/custom-css. Static curated markdown.
 */

export function generateCustomCssReference(): string {
  return `# Custom CSS

CSS snippets restyle the whole app. The \`cssclasses\` property restyles single notes. Both are plain CSS.

## CSS snippets

A snippet is a \`.css\` file in the vault's snippets folder, applied vault-wide once enabled. The settings UI lists them under Settings, Appearance, CSS snippets.

Through this plugin, snippets are a virtual namespace:

- List them: \`view(action="folder", path="obsidian://snippets/")\`
- Read one: \`view(action="read", path="obsidian://snippets/<name>.css")\`
- Edit one: the edit tool on the same URI. The app picks up file changes without a restart.
- Create or delete: the files tool on the URI. Writes need the plugin setting "Allow snippet editing". Delete is permanent, and an enabled snippet refuses deletion until it is disabled.

## Enable and disable a snippet

Enabled snippets are the \`enabledCssSnippets\` app setting: an array of snippet ids, the file name without the \`.css\` suffix. Read it:

\`\`\`
view(action="read", path="obsidian://config/enabledCssSnippets")
\`\`\`

Edit the array with the edit tool to enable or disable ids. The write needs the plugin setting "Allow config editing" and applies live: each membership change routes through the app's own toggle handler. Writing \`[]\` disables every snippet.

## Per-note styling with cssclasses

The \`cssclasses\` frontmatter property applies CSS classes to one note, in Reading view and Live Preview:

\`\`\`yaml
---
cssclasses:
  - wide-tables
---
\`\`\`

Prefix the snippet rules with the class so they affect only the notes that carry it:

\`\`\`css
.wide-tables table {
    width: 100%;
}
\`\`\`

The property is a list. A note can carry several classes. The singular form \`cssclass\` also works.

## Callout styling

Callouts expose CSS variables for color, icon, and border. A snippet can restyle the built-in types or define new ones. See \`obsidian://resources/syntax/callouts\`.

## Notes

- Snippets apply to every note. They are a per-installation setting, not vault content: a sync setup that excludes the config folder keeps each device's enables separate.
- Use the developer tools to inspect elements and find the classes to target.
- An app rule can re-assert a style with \`!important\`. A snippet override of such a rule needs the same strength.
`;
}
