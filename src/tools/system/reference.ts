/**
 * The system tool reference behind the MCP resource
 * obsidian://resources/system. Static curated markdown, in the shape of
 * the Dataview reference: the content lives here, not in any vault.
 */

export function generateSystemReference(): string {
  return `# system

App-level actions: server status, the command palette, workflow hints, and opening files in the app. Web fetch rides here too, gated.

## Actions

- **info** — server details: plugin and Obsidian versions, transport state, connection counts, vault name. No parameters.
- **commands** — the Obsidian commands of the command palette, grouped by plugin. Read the list, then run one through the app. No parameters.
- **hints** — contextual suggestions for next actions, based on recent context such as the last file or the last search. No required parameters.
- **open_in_obsidian** — open a file in the Obsidian app. \`path\` required.
- **fetch_web** — fetch a URL and convert it to markdown. \`url\` required. Conditionally registered: the web-fetch setting of the plugin can hide it from the action enum. When hidden, the schema drops the \`url\` parameter with it. Off by default. When enabled, internal addresses — localhost, the local network, cloud metadata — stay blocked.

## Parameters

| Param | Type | Actions | Default |
|---|---|---|---|
| path | string, required | open_in_obsidian | — |
| url | string, required | fetch_web | — |

## Rules

- An opt-in plugin setting can rate-limit tool calls per credential. A refused call returns \`RATE_LIMITED\` with a \`retryAfterMs\` delay.
- \`open_in_obsidian\` is charged as a read: opening a note changes nothing in the vault, and it works in read-only mode.
- Command execution is not exposed as an action. The palette contains destructive commands, so running them by id is denied for restricted credentials.
`;
}
