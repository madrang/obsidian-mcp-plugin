/**
 * Declarative setting definitions for Obsidian 1.13+ settings search.
 *
 * The settings tab renders imperatively (cross-version; the 1.13 declarative
 * renderer never runs for this tab). These definitions exist so the settings
 * search indexer can find every setting: each named row in the tab appears
 * here with its group, description, and — where the tab renders a row only
 * under a condition — the same visibility condition.
 *
 * Rows are intentionally control-free (SettingDefinitionEmpty): a search hit
 * navigates to the tab, where the real control lives. A control bound here
 * would bypass the onChange side effects (server restarts, notices, context
 * menu registration) that the imperative rows perform.
 *
 * buildSettingDefinitions is pure and exported so the test suite can assert
 * coverage without constructing the tab. The settings parameter is
 * structural: main.ts's MCPPluginSettings satisfies it without an import
 * cycle.
 */
import type { SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import { ALL_OPERATIONS, getActionsForOperation } from './tools/semantic-tools';
import type { ScopedToken } from './security/http-auth';

/** The slice of the plugin settings the definitions read from. */
export interface SettingsForDefinitions {
  bindMode: string;
  httpsEnabled: boolean;
  sessionTimeoutMs: number;
  pathExclusionsEnabled: boolean;
  scopedTokens: ScopedToken[];
}

export function buildSettingDefinitions(settings: SettingsForDefinitions, dataviewAvailable: boolean): SettingDefinitionItem[] {
  const visibilityOps = ALL_OPERATIONS.filter(op => op !== 'dataview' || dataviewAvailable);

  const toolVisibilityItems: SettingGroupItem[] = visibilityOps.flatMap((op): SettingGroupItem[] => [
    { name: op, desc: `Show or hide the ${op} tool`, aliases: ['tool', 'visibility'] },
    ...getActionsForOperation(op)
      // fetch_web is governed by the dedicated web-fetch toggle (ADR-109),
      // not by the visibility tree — same exclusion as the rendered section.
      .filter(action => !(op === 'system' && action === 'fetch_web'))
      .map((action): SettingGroupItem => ({
        name: `${op}.${action}`,
        desc: `Show or hide the ${action} action of the ${op} tool`,
        aliases: ['tool', 'visibility', op, action]
      }))
  ]);
  toolVisibilityItems.push({
    name: 'Allow overwrite',
    desc: 'Let files actions replace existing content (overwrite=true)',
    aliases: ['files', 'overwrite']
  });

  const scopedTokenItems: SettingGroupItem[] = settings.scopedTokens.map((token, index) => ({
    name: token.name || `Scoped token ${index + 1}`,
    desc: `Folder: ${token.folder ?? 'whole vault'}${token.readOnly === true ? ' — read-only' : ''}`,
    aliases: ['scoped token', 'token', 'folder']
  }));

  return [
    {
      type: 'group',
      heading: 'Server configuration',
      items: [
        { name: 'Enable HTTP server', desc: 'Enable the HTTP server', aliases: ['http', 'server'] },
        { name: 'Server port', desc: 'Port for the server (default: 3011)', aliases: ['http', 'port'] },
        { name: 'Auto-detect port conflicts', desc: 'Automatically detect and warn about port conflicts', aliases: ['port'] },
        { name: 'Sessions never expire', desc: 'Keep sessions valid until the client disconnects or a session limit evicts them', aliases: ['session', 'expire', 'timeout'] },
        { name: 'Session timeout in minutes', desc: 'Idle time after which a session expires', aliases: ['session', 'expire', 'timeout'], visible: () => settings.sessionTimeoutMs > 0 },
        { name: 'Sessions per token', desc: 'How many sessions one credential can hold at once, including the main key', aliases: ['session', 'token', 'limit'] }
      ]
    },
    {
      type: 'group',
      heading: 'Network binding',
      items: [
        { name: 'Bind address', desc: 'Which network interface the MCP server listens on', aliases: ['bind', 'loopback', 'interface', 'host'] },
        { name: 'Custom bind address', desc: 'IPv4/IPv6/hostname to bind to', aliases: ['bind', 'host', 'ip'], visible: () => settings.bindMode === 'custom' }
      ]
    },
    {
      type: 'group',
      heading: 'Secure transport',
      items: [
        { name: 'Enable HTTPS server', desc: 'Enable the HTTPS server', aliases: ['https', 'tls', 'certificate'] },
        { name: 'Secure port', desc: 'Port for secure connections (default: 3444)', aliases: ['https', 'port'], visible: () => settings.httpsEnabled },
        { name: 'Auto-generate certificate', desc: 'Automatically generate a self-signed certificate if none exists', aliases: ['https', 'tls', 'certificate'], visible: () => settings.httpsEnabled },
        { name: 'Certificate path', desc: 'Path to a custom certificate file (.crt)', aliases: ['https', 'tls', 'certificate'], visible: () => settings.httpsEnabled },
        { name: 'Key path', desc: 'Path to the private key file (.key)', aliases: ['https', 'tls', 'certificate', 'key'], visible: () => settings.httpsEnabled },
        { name: 'Minimum TLS version', desc: 'Minimum TLS version to accept', aliases: ['https', 'tls'], visible: () => settings.httpsEnabled }
      ]
    },
    {
      type: 'group',
      heading: 'Authentication',
      items: [
        { name: 'Authentication key', desc: 'Secure key for authenticating MCP clients', aliases: ['api key', 'token', 'bearer', 'scoped token'] },
        { name: 'Disable authentication', desc: 'Dangerous: disable authentication entirely', aliases: ['auth', 'dangerously'] }
      ]
    },
    {
      type: 'group',
      heading: 'Scoped tokens',
      items: scopedTokenItems
    },
    {
      type: 'group',
      heading: 'Security',
      items: [
        { name: 'Read-only mode', desc: 'Blocks every operation that changes the vault', aliases: ['readonly', 'read only', 'writes'] },
        { name: 'Allow outbound web fetch', desc: 'Lets connected agents fetch web pages (system.fetch_web)', aliases: ['web', 'fetch', 'fetch_web', 'internet'] },
        { name: 'Path exclusions', desc: 'Exclude files and directories from MCP operations using .gitignore-style patterns', aliases: ['mcpignore', 'ignore', 'exclude'] },
        { name: 'Enable right-click context menu', desc: 'Add an "add to .mcpignore" option to file and folder context menus', aliases: ['context menu', 'mcpignore'], visible: () => settings.pathExclusionsEnabled }
      ]
    },
    {
      type: 'group',
      heading: 'Tool visibility',
      items: toolVisibilityItems
    },
    {
      type: 'group',
      heading: 'Interface',
      items: [
        { name: 'Show connection status', desc: 'Show MCP server status in the status bar', aliases: ['status bar'] },
        { name: 'Debug logging', desc: 'Enable detailed debug logging in console', aliases: ['debug', 'logs'] }
      ]
    }
  ];
}
