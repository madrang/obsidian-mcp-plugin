/**
 * The version-check resource behind the MCP resource
 * obsidian://resources/version-check: the steps for an agent to compare
 * the installed plugin version, read from the system tool, against the
 * latest stable release on GitHub.
 */

export function generateVersionCheckReference(): string {
  return `# Version check

Steps for an agent to learn whether the installed plugin is the latest release. The installed version answers through this server. The latest release answers through GitHub.

## Read the installed version

Call the \`system\` tool with the action \`info\`. The response carries \`versions.self\`, the version of the plugin now running. The resource \`obsidian://resources/infos/vault\` carries the same value as \`plugin.version\`.

## Read the latest released version

The releases of this plugin live under \`madrang/obsidian-mcp-plugin\` on GitHub. Two addresses answer the latest stable release:

- \`https://github.com/madrang/obsidian-mcp-plugin/releases/latest/download/manifest.json\` — the \`manifest.json\` asset of the release marked Latest. The answer is JSON. Read its \`version\` field.
- \`https://api.github.com/repos/madrang/obsidian-mcp-plugin/releases/latest\` — the GitHub API. Read its \`tag_name\` field. Release tags carry no \`v\` prefix, so the tag equals the version string.

Fetch the address through the \`system\` tool with the action \`fetch_web\` and the address as \`url\`, when the session registers that action. The plugin gates it behind an opt-in setting, off by default. Otherwise use a web tool of the calling harness.

The addresses resolve to the release marked Latest. A prerelease without that mark stays invisible to them. The comparison covers the stable channel only.

## Compare

Both sides are version strings of three numbers, for example \`1.1.13\`. Compare them as numbers from left to right.

- Equal: the install is current. Nothing to report.
- Installed lower: the install lags. Report both versions to the user.
- Installed higher: the install runs ahead of the latest release. State that fact, then continue.

## On an outdated install

Tell the user the installed version and the latest version. The user updates the plugin: the Obsidian updater, BRAT, or the release assets \`main.js\`, \`manifest.json\`, and \`styles.css\` from \`https://github.com/madrang/obsidian-mcp-plugin/releases\`. The user then reloads the plugin in Obsidian. An agent never updates the plugin itself. The server of this session is that plugin, and its files sit outside the vault, beyond every tool of this surface.
`;
}
