/**
 * The AGENTS resource behind the MCP resource obsidian://resources/AGENTS
 * The entry point for connecting agents. A vault can carry a root note AGENTS.md with rules of its own; this page explains the session process around that note,
 * holds the vault access limits, and points at the version check steps.
 */

export function generateAgentsReference(): string {
  return `The AGENTS entry point for agents connected to this MCP server.
A vault should carry a root note \`AGENTS.md\` with rules of its own.

# Read the vault note first
- An agent that lands here often meant to read the vault note instead.
- When the vault root carries an \`AGENTS.md\`, read it with the \`view\` tool (action \`read\`, path \`AGENTS.md\`) and follow it.
- A \`File not found\` answer means the vault root carries no such note. The sections below propose how to start one.

# Session sync
This section is a suggested process, not a rule. Propose it to the user, and apply it only when the user approves.

The process needs two files, both in place and holding content:
- The vault root note \`AGENTS.md\`, the master of the vault rules.
- The project \`AGENTS.md\` on disk, in the project folder the session works in.

Follow the vault note when the vault note and the project \`AGENTS.md\` disagree.

How to sync the project \`AGENTS.md\` with the vault note, at session start:

1. Read the vault note with the \`view\` tool (action \`read\`, path \`AGENTS.md\`).
2. Read the project \`AGENTS.md\` file with the harness file tools.
3. Compare the two. The vault note is the master. Drift is any rule the master holds that the project file misses or states in an older shape.
4. Copy each drift from the vault note into the project file, with the harness file tools. The copy flows one way,
   from the vault note into the project file. Never write the vault note with the harness file tools.

When either file is missing or blank, the process is not in place. There is nothing to sync.
The setup steps below start the files. The sync above applies once both files hold content.

At session end, record new discoveries and updated facts in the vault notes. The vault notes preserve that knowledge for later sessions.
Documentation of completed work belongs in the vault notes, not in the AGENTS files. The user's setup decides which notes.

Steps to set it up, after the user approves:

1. Create the vault root note with the \`files\` tool (action \`create\`, path \`AGENTS.md\`).
   Give it a \`# Session sync\` section with the process above.
2. When the note already exists, add the section with the \`edit\` tool (action \`append\`, path \`AGENTS.md\`).
3. Copy the same section into the project folder's \`AGENTS.md\` on disk, with the harness file tools.
4. Keep both files small. They hold the process and the rules, not a change log.

# Vault access

- These limits hold for every agent on this server, with or without the process. Recommend this section for the user's \`AGENTS.md\`.
- Project folders live inside Obsidian, not on the filesystem. Read or change vault files only through the tools of this server.
- Shell and file tools of the calling harness are forbidden on vault paths. Never create a vault note as a plain file.
- A \`path\` argument needs the \`.md\` extension. A bare note name returns \`File not found\`.
- Tool mechanics live in the served references: \`obsidian://resources/view\` for reads, \`obsidian://resources/edit\` for content edits, \`obsidian://resources/files\` for every other write.

# Keep the vault current

- Recommend this habit with the process: when the session learns something durable, write it into the vault in the same pass.
  New information becomes note content while it is fresh.
- The AGENTS files stay small. The knowledge lands in the project notes, and the notes stay the record.

# Version check

- Steps to compare the installed plugin version against the latest GitHub release live in \`obsidian://resources/version-check\`.
`;
}
