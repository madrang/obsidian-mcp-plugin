/** Getting started: the connect-a-client guide. A display, not a setting. */
import { Setting } from 'obsidian';
import { getActionsForOperation } from '../../tools/tool-factory';
import type { SettingsUIHost } from '../host-types';
import { addCopyButton, renderJsonConfigBlock, resetRenderRow, Group } from '../ui-helpers';

export function gettingStartedGroup(host: SettingsUIHost): Group {
  return {
    type: 'group'
    , heading: 'Getting started — connect a client'
    , items: [{
      name: 'Connection guide'
      , searchable: false
      , render: (setting: Setting) => {
        const s = host.settings;
        const info = resetRenderRow(setting);
        const block = info.createDiv('mcp-protocol-info');

        if (s.dangerouslyDisableAuth) {
          block.createDiv({
            text: '⚠️ warning: authentication is disabled. Your vault is accessible without credentials!'
            , cls: 'mcp-warning-box'
          });
        }

        // Tools list, with per-action visibility counts
        const visibility = s.toolVisibility;
        const dataviewAvailable = host.isDataviewAvailable();
        const toolEntries = [
          { name: 'files', emoji: '🗂️', desc: 'File management: create, delete, move, copy, split, concat' }
          , { name: 'edit', emoji: '✏️', desc: 'Smart editing with content buffers' }
          , { name: 'view', emoji: '👁️', desc: 'Folder listing, reading, and search' }
          , { name: 'graph', emoji: '🕸️', desc: 'Graph traversal and link analysis' }
          , { name: 'system', emoji: '⚙️', desc: 'System info, commands, hints, and web fetch' }
          , { name: 'bases', emoji: '🗃️', desc: 'Bases query and management' }
          , { name: 'dataview', emoji: '📊', desc: 'Query vault data with DQL' }
        ,];
        const toolsListEl = block.createEl('ul');
        for (const entry of toolEntries) {
          if (entry.name === 'dataview' && !dataviewAvailable) continue;
          const actions = getActionsForOperation(entry.name);
          const enabledActions = actions.filter(a => visibility[`${entry.name}.${a}`] !== false);
          const isDisabled = visibility[entry.name] === false || enabledActions.length === 0;
          const li = toolsListEl.createEl('li', { text: `${entry.emoji} ${entry.name} - ${entry.desc}` });
          if (isDisabled) {
            li.addClass('mcp-tool-disabled');
            li.createSpan({ text: ' (hidden)', cls: 'mcp-tool-count' });
          } else if (enabledActions.length < actions.length) {
            li.createSpan({ text: ` (${enabledActions.length}/${actions.length} actions)`, cls: 'mcp-tool-count' });
          }
        }
        block.createEl('p', {
          text: dataviewAvailable
            ? `🔌 Plugin Integrations: Dataview v${host.dataviewVersion()} (enabled)`
            : '🔌 Plugin integrations: none detected (install dataview for additional functionality)'
          , cls: 'plugin-integration-status'
        });

        const resourcesList = block.createEl('ul');
        // The URIs stay in variables: exact, copyable, and out of the
        // sentence-case rule's reach (the Obsidian brand casing would
        // capitalize the scheme). Same pattern as the MCP URL rows below.
        const vaultInfoUri = 'obsidian://resources/infos/vault';
        const sessionInfoUri = 'obsidian://resources/infos/session';
        const vaultInfoItem = resourcesList.createEl('li');
        vaultInfoItem.createSpan({ text: '📊 Real-time vault metadata: ' });
        vaultInfoItem.createEl('code', { text: vaultInfoUri, cls: 'mcp-code-inline' });
        const sessionInfoItem = resourcesList.createEl('li');
        sessionInfoItem.createSpan({ text: '🔄 Active MCP sessions and statistics: ' });
        sessionInfoItem.createEl('code', { text: sessionInfoUri, cls: 'mcp-code-inline' });

        const protocol = s.httpsEnabled ? 'https' : 'http';
        const port = s.httpsEnabled ? s.httpsPort : s.httpPort;
        const baseUrl = `${protocol}://localhost:${port}`;
        const mcpUrl = `${baseUrl}/mcp`;

        // MCP bundle
        const bundleHeading = block.createEl('p', { cls: 'setting-item-description' });
        bundleHeading.createEl('strong', { text: 'MCP bundle (.mcpb — one-click install)' });
        block.createEl('p', {
          text: 'Download the bundle, drop it onto an MCP client that supports bundles, and paste these values in the install prompt.'
        });
        const mcpbUrl = 'https://github.com/madrang/obsidian-mcp-plugin/releases/latest/download/scoped-vault-mcp.mcpb';
        const downloadEl = block.createDiv('mcpb-download');
        const downloadLink = downloadEl.createEl('a', {
          text: '⬇ Scoped-vault-mcp.mcpb'
          , href: mcpbUrl
          , cls: 'mcp-mcpb-download',
        });
        downloadLink.setAttribute('target', '_blank');
        downloadLink.setAttribute('rel', 'noopener');

        const mcpbValuesEl = block.createDiv('mcpb-values');
        const urlRow = mcpbValuesEl.createDiv('mcp-config-container');
        urlRow.createEl('strong', { text: 'URL: ' });
        urlRow.createEl('code', { text: mcpUrl, cls: 'mcp-code-inline' });
        addCopyButton(urlRow, mcpUrl);

        if (!s.dangerouslyDisableAuth) {
          const keyRow = mcpbValuesEl.createDiv('mcp-config-container');
          keyRow.createEl('strong', { text: 'API key: ' });
          keyRow.createEl('code', { text: s.apiKey, cls: 'mcp-code-inline' });
          addCopyButton(keyRow, s.apiKey);
        }

        // JSON config — the universal path
        const jsonHeading = block.createEl('p', { cls: 'setting-item-description' });
        jsonHeading.createEl('strong', { text: 'Any MCP client (JSON config)' });
        block.createEl('p', {
          text: 'Add this to the client\'s MCP config file. One entry per vault if you run several Obsidian instances on different ports:'
        });
        const configContainer = block.createDiv('protocol-command-example');
        renderJsonConfigBlock(configContainer, s, host.app.vault.getName());

        const advanced = block.createEl('details', { cls: 'mcp-advanced-details' });
        advanced.createEl('summary', { text: 'Advanced — multi-vault, custom bundles', cls: 'mcp-advanced-summary' });
        advanced.createEl('p', {
          text: 'Clone the plugin repo and run `node scripts/make-mcpb.mjs`. It prompts for a display name, url, and api key, then writes a custom-named .mcpb you drop into a bundle-compatible client — one-click install per vault, no fields to type at install time.'
        });
      }
    }]
  };
}
