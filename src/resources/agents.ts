/**
 * The AGENTS resource behind the MCP resource
 * obsidian://resources/AGENTS: the two session-start rules every
 * connecting agent needs, whatever IDE or harness runs the session, plus
 * the pointer to the version check steps. The vault root AGENTS.md stays
 * the master of the vault rules; this page serves the clients that reach
 * the vault only through MCP.
 */

export function generateAgentsReference(): string {
  return `# AGENTS

Session-start rules for any agent connected through this MCP server, whatever IDE or harness runs the session. The vault root note \`AGENTS.md\` is the master of the vault rules. This page serves two of those rules to MCP clients, plus one pointer.

## Session sync

- Read this page at session start. A successful read confirms that Obsidian and the MCP server answer. When the read fails, Obsidian is down. Tell the user to start it, then stop.
- When the vault root carries an \`AGENTS.md\`, read it with the \`view\` tool (action \`read\`, path \`AGENTS.md\`). It is the master of the vault rules. Follow the master when it and this page disagree.
- When the session also works in a project folder on disk with its own \`AGENTS.md\`, compare that file against the vault master. Copy any drift from the master into the project file before other work.
- At session end, compare the two files again. Documentation of completed work belongs in the project notes inside the vault, not in the AGENTS files.

## Vault access

- Project folders live inside Obsidian, not on the filesystem. Read or change vault files only through the tools of this server.
- Shell and file tools of the calling harness stay forbidden on vault paths. They error, or they hit a stale disk mirror.
- Never create a vault note as a plain file.
- A \`path\` argument needs the \`.md\` extension. A bare note name returns \`File not found\`.
- Tool mechanics live in the served references: \`obsidian://resources/view\` for reads, \`obsidian://resources/edit\` for content edits, \`obsidian://resources/files\` for every other write.

## Version check

- Check the plugin version at session start. An agent that meets a tool error can check again: an old install can explain the failure.
- The steps live in \`obsidian://resources/version-check\`.
`;
}
