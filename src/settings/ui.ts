/**
 * The settings tab UI as declarative definitions (Obsidian 1.13+).
 *
 * The tab renders entirely from getSettingDefinitions(); there is no
 * imperative display() path (minAppVersion 1.13.0). Three definition shapes
 * cover the tab:
 *
 *   - control rows: toggles, numbers, texts, and dropdowns bound to settings
 *     keys. The tab's getControlValue/setControlValue overrides resolve the
 *     keys (including synthetic ones like 'sessionsNeverExpire' and
 *     'vis.files.create') and carry every side effect — server restarts,
 *     notices, tool-list notifications.
 *   - render rows: the custom blocks (status grid, getting-started guide,
 *     certificate status, .mcpignore management, per-token editors). The
 *     callback receives a Setting and builds the same DOM the imperative
 *     code did.
 *   - a list: scoped tokens, with add/delete affordances from the framework.
 *
 * Every row carries name/desc/aliases so the 1.13 settings search indexes
 * it. Render rows are searchable:false — they are displays, not settings.
 */
import { ButtonComponent, FileSystemAdapter, Notice, Setting, setIcon, TFolder } from 'obsidian';
import type { SettingDefinitionItem, SettingGroupItem, SettingDefinitionGroup, SettingDefinitionList } from 'obsidian';
import { FolderScopeSuggest } from './folder-suggest';
import { ALL_OPERATIONS, getActionsForOperation, getOperationDescription } from '../tools/semantic-tools';
import { classifyFromSettings } from '../utils/network-classifier';
import { Debug } from '../utils/debug';
import type { MCPPluginSettings } from './plugin-settings';
import type { SettingsUIHost } from './host-types';

export type { SettingsUIHost };

type Group = SettingDefinitionGroup;

/** Copy-to-clipboard button with the 2-second success flash. */
function addCopyButton(container: HTMLElement, textToCopy: string): void {
  container.classList.add('mcp-config-container');
  const copyButton = container.createEl('button', { cls: 'mcp-copy-button' });
  copyButton.setAttribute('aria-label', 'Copy to clipboard');
  setIcon(copyButton, 'copy');
  copyButton.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copyButton.classList.add('success');
        setIcon(copyButton, 'check');
        window.setTimeout(() => {
          setIcon(copyButton, 'copy');
          copyButton.classList.remove('success');
        }, 2000);
      } catch (error) {
        new Notice('Failed to copy to clipboard');
        Debug.error('Failed to copy to clipboard:', error);
      }
    })();
  });
}

/**
 * The JSON-config snippet block, shared by the getting-started render row
 * and the tab's 3-second live updater. Empties the container first.
 */
export function renderJsonConfigBlock(container: HTMLElement, settings: MCPPluginSettings, vaultName: string): void {
  container.empty();
  const protocol = settings.httpsEnabled ? 'https' : 'http';
  const port = settings.httpsEnabled ? settings.httpsPort : settings.httpPort;
  const mcpUrl = `${protocol}://localhost:${port}/mcp`;
  const configJson = settings.dangerouslyDisableAuth ? {
    "mcpServers": { [vaultName]: { "transport": { "type": "http", "url": mcpUrl } } }
  } : {
    "mcpServers": {
      [vaultName]: {
        "transport": { "type": "http", "url": mcpUrl, "headers": { "Authorization": `Bearer ${settings.apiKey}` } }
      }
    }
  };
  const configJsonText = JSON.stringify(configJson, null, 2);
  const configEl = container.createEl('pre');
  configEl.classList.add('mcp-config-example');
  configEl.textContent = configJsonText;
  addCopyButton(container, configJsonText);
}

function validatePort(value: number): string | void {
  if (!Number.isInteger(value) || value <= 0 || value >= 65536) {
    return 'Port must be a whole number between 1 and 65535';
  }
}

function validateMinutes(value: number): string | void {
  if (!Number.isInteger(value) || value < 1) {
    return 'Timeout must be at least 1 minute';
  }
}

function validateSessionCap(value: number): string | void {
  if (!Number.isInteger(value) || value < 1) {
    return 'The limit must be at least 1';
  }
}

function validateRateLimit(value: number): string | void {
  if (!Number.isInteger(value) || value < 0) {
    return 'Rate limit must be 0 (disabled) or a whole number of calls per minute';
  }
}

/** Getting started: the connect-a-client guide. A display, not a setting. */

/**
 * update() re-invokes a render callback into the same Setting element rather
 * than rebuilding the row. A render callback must therefore reset the areas
 * it fills — the control area (addText/addButton and friends append there)
 * and its `.mcp-render-block` child — or every update() appends a second
 * copy of the row's content. The framework-managed name and description sit
 * outside both areas and survive.
 */
function resetRenderRow(setting: Setting): HTMLElement {
  setting.settingEl.addClass('mcp-has-render-block');
  setting.controlEl.empty();
  const existing = setting.settingEl.querySelector<HTMLElement>(':scope > .mcp-render-block');
  if (existing) {
    existing.empty();
    return existing;
  }
  return setting.settingEl.createDiv('mcp-render-block');
}

function gettingStartedGroup(host: SettingsUIHost): Group {
  return {
    type: 'group',
    heading: 'Getting started — connect a client',
    items: [{
      name: 'Connection guide',
      searchable: false,
      render: (setting: Setting) => {
        const s = host.settings;
        const info = resetRenderRow(setting);
        const block = info.createDiv('mcp-protocol-info');

        if (s.dangerouslyDisableAuth) {
          block.createDiv({
            text: '⚠️ warning: authentication is disabled. Your vault is accessible without credentials!',
            cls: 'mcp-warning-box'
          });
        }

        // Tools list, with per-action visibility counts
        const visibility = s.toolVisibility;
        const dataviewAvailable = host.isDataviewAvailable();
        const toolEntries = [
          { name: 'files', emoji: '🗂️', desc: 'File management: create, delete, move, copy, split, concat' },
          { name: 'edit', emoji: '✏️', desc: 'Smart editing with content buffers' },
          { name: 'view', emoji: '👁️', desc: 'Folder listing, reading, and search' },
          { name: 'graph', emoji: '🕸️', desc: 'Graph traversal and link analysis' },
          { name: 'system', emoji: '⚙️', desc: 'System info, commands, hints, and web fetch' },
          { name: 'bases', emoji: '🗃️', desc: 'Bases query and management' },
          { name: 'dataview', emoji: '📊', desc: 'Query vault data with DQL' },
        ];
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
            : '🔌 Plugin integrations: none detected (install dataview for additional functionality)',
          cls: 'plugin-integration-status'
        });

        const resourcesList = block.createEl('ul');
        resourcesList.createEl('li', { text: '📊 Obsidian://vault-info - real-time vault metadata' });
        resourcesList.createEl('li', { text: '🔄 Obsidian://session-info - active MCP sessions and statistics' });

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
          text: '⬇ Scoped-vault-mcp.mcpb',
          href: mcpbUrl,
          cls: 'mcp-mcpb-download',
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

/** Live server status grid. A display, not a setting. */
function connectionStatusGroup(host: SettingsUIHost): Group {
  return {
    type: 'group',
    heading: 'Connection status',
    items: [{
      name: 'Server status display',
      searchable: false,
      render: (setting: Setting) => {
        const statusEl = resetRenderRow(setting);
        const grid = statusEl.createDiv('mcp-status-section');
        const info = host.getServerInfo();
        if (!info) {
          grid.createDiv({ text: 'Server not running', cls: 'mcp-status-offline' });
          return;
        }
        const statusGrid = grid.createDiv('mcp-status-grid');
        const createStatusItem = (label: string, value: string, colorClass?: string) => {
          const item = statusGrid.createDiv();
          item.createEl('strong', { text: `${label}: ` });
          const valueEl = item.createSpan({ text: value });
          if (colorClass) valueEl.classList.add('mcp-status-value', colorClass);
        };
        createStatusItem('Status', info.running ? 'Running' : 'Stopped', info.running ? 'success' : 'error');
        createStatusItem('Port', (info.httpsEnabled ? info.httpsPort : info.httpPort).toString());
        createStatusItem('Vault', info.vaultName);
        if (info.vaultPath) {
          createStatusItem('Path', info.vaultPath.length > 50 ? '...' + info.vaultPath.slice(-47) : info.vaultPath);
        }
        const versionItem = statusGrid.createDiv();
        versionItem.createEl('strong', { text: 'Version: ' });
        const versionEl = versionItem.createSpan({ text: info.version, cls: 'mcp-version-easter-egg' });
        versionEl.addEventListener('click', () => host.onVersionClick());
        createStatusItem('Tools', info.toolsCount.toString());
        createStatusItem('Resources', info.resourcesCount.toString());
        createStatusItem('Connections', info.connections.toString());
        if (info.poolStats?.enabled && info.poolStats.stats) {
          const poolStats = info.poolStats.stats;
          createStatusItem('Active Sessions', `${poolStats.activeConnections}/${poolStats.maxConnections}`);
          createStatusItem('Pool Utilization', `${Math.round(poolStats.utilization * 100)}%`,
            poolStats.utilization > 0.8 ? 'warning' : 'success');
          if (poolStats.queuedRequests > 0) {
            createStatusItem('Queued Requests', poolStats.queuedRequests.toString(), 'warning');
          }
        }
      }
    }]
  };
}

function serverConfigGroup(host: SettingsUIHost): Group {
  const s = host.settings;
  return {
    type: 'group',
    heading: 'Server configuration',
    items: [
      {
        name: 'Enable HTTP server',
        desc: `Enable HTTP server on port ${s.httpPort}` + (s.httpsEnabled ? ' (can be disabled when HTTPS is enabled)' : ' (required - at least one protocol must be enabled)'),
        aliases: ['http', 'server'],
        control: { type: 'toggle', key: 'httpEnabled', disabled: () => !host.settings.httpsEnabled }
      },
      {
        name: 'Server port',
        desc: 'Port for the server (default: 3011). Applies on change; restarts the server when it is running.',
        aliases: ['http', 'port'],
        control: { type: 'number', key: 'httpPort', placeholder: '3011', validate: validatePort }
      },
      {
        name: 'Auto-detect port conflicts',
        desc: 'Automatically detect and warn about port conflicts',
        aliases: ['port'],
        control: { type: 'toggle', key: 'autoDetectPortConflicts' }
      },
      {
        name: 'Sessions never expire',
        desc: 'Keep sessions valid until the client disconnects or a session limit evicts them. An old session ID can resume at any time. Turn off to expire idle sessions after a timespan.',
        aliases: ['session', 'expire', 'timeout'],
        control: { type: 'toggle', key: 'sessionsNeverExpire' }
      },
      {
        name: 'Session timeout in minutes',
        desc: 'Idle time after which a session expires',
        aliases: ['session', 'expire', 'timeout'],
        visible: () => host.settings.sessionTimeoutMs > 0,
        control: { type: 'number', key: 'sessionTimeoutMinutes', placeholder: '60', validate: validateMinutes }
      },
      {
        name: 'Sessions per token',
        desc: 'How many sessions one credential can hold at once, including the main key. A new session past the limit invalidates the oldest session of that credential.',
        aliases: ['session', 'token', 'limit'],
        control: { type: 'number', key: 'sessionsPerToken', placeholder: '1', validate: validateSessionCap }
      },
      {
        name: 'Tool call rate limit',
        desc: "Maximum tool calls per credential per minute, across all of that credential's sessions. 0 disables the limit (default). Takes effect immediately; a refused call returns the RATE_LIMITED error with a retry delay.",
        aliases: ['rate', 'limit', 'throttle', 'per minute', 'calls'],
        control: { type: 'number', key: 'rateLimitPerMinute', placeholder: '0', validate: validateRateLimit }
      }
    ]
  };
}

function networkBindingGroup(host: SettingsUIHost): Group {
  return {
    type: 'group',
    heading: 'Network binding',
    items: [
      {
        name: 'Network exposure display',
        searchable: false,
        render: (setting: Setting) => {
          const s = host.settings;
          const verdict = classifyFromSettings({
            httpsEnabled: s.httpsEnabled,
            bindMode: s.bindMode,
            customBindHost: s.customBindHost,
            userSuppliedCert: !!(s.certificateConfig?.certPath && s.certificateConfig?.keyPath)
          });
          const container = resetRenderRow(setting);
          const badgeEmoji = verdict.class === 'ok' ? '🟢' : verdict.class === 'warn' ? '🟡' : '🔴';
          const badgeLabel = verdict.class === 'ok' ? 'OK' : verdict.class === 'warn' ? 'WARN' : 'INSECURE';
          const badgeEl = container.createDiv({ cls: `mcp-network-badge mcp-network-badge-${verdict.class}` });
          badgeEl.createEl('strong', { text: `${badgeEmoji} ${badgeLabel} — ` });
          badgeEl.createSpan({ text: verdict.reason });
          if (verdict.class === 'jail') {
            badgeEl.createEl('br');
            badgeEl.createSpan({
              text: 'Reconfigure: switch the bind address below to Loopback, or enable HTTPS.',
              cls: 'mcp-network-badge-hint'
            });
          }
          if (s.bindMode === 'all') {
            const caution = container.createDiv({ cls: 'mcp-network-caution' });
            caution.createEl('strong', { text: '⚠ All interfaces selected. ' });
            caution.createSpan({
              text: s.httpsEnabled
                ? 'Encrypted via HTTPS — clients must trust the certificate. Use a real (non-self-signed) cert for public networks.'
                : 'API key and document text will be sent in cleartext over the network. Enable HTTPS or switch to loopback.'
            });
          }
          if (s.bindMode === 'custom' && s.customBindHost.trim() === '') {
            const empty = container.createDiv({ cls: 'mcp-network-caution' });
            empty.createSpan({ text: 'No custom address entered yet — server will fall back to loopback (127.0.0.1) until you enter one.' });
          }
        }
      },
      {
        name: 'Bind address',
        desc: 'Which network interface the MCP server listens on. Loopback only is recommended.',
        aliases: ['bind', 'loopback', 'interface', 'host'],
        control: {
          type: 'dropdown',
          key: 'bindMode',
          options: {
            'loopback': 'Loopback only — local machine',
            'all': 'All interfaces — anyone on the network can attempt to connect',
            'custom': 'Custom address…'
          }
        }
      },
      {
        name: 'Custom bind address',
        desc: 'IPv4/IPv6/hostname to bind to. Typing only stores the value; the Apply row below normalizes it and restarts the server.',
        aliases: ['bind', 'host', 'ip'],
        visible: () => host.settings.bindMode === 'custom',
        control: { type: 'text', key: 'customBindHost', placeholder: 'e.g. 192.168.1.50' }
      },
      {
        name: 'Apply custom bind address',
        desc: 'Normalize and apply the address. A loopback address switches the mode to loopback; a wildcard switches to all interfaces.',
        visible: () => host.settings.bindMode === 'custom',
        action: () => { void host.applyCustomBindHost(); }
      }
    ]
  };
}

function secureTransportGroup(host: SettingsUIHost): Group {
  const s = host.settings;
  const httpsOn = () => host.settings.httpsEnabled;
  return {
    type: 'group',
    heading: 'Secure transport',
    items: [
      {
        name: 'Enable HTTPS server',
        desc: `Enable HTTPS server on port ${s.httpsPort}` + (s.httpEnabled ? ' (optional when HTTP is enabled)' : ' (required - cannot be disabled when HTTP is disabled)'),
        aliases: ['https', 'tls', 'certificate'],
        control: {
          type: 'toggle',
          key: 'httpsEnabled',
          disabled: () => !host.settings.httpEnabled && host.settings.httpsEnabled
        }
      },
      {
        name: 'Secure port',
        desc: 'Port for secure connections (default: 3444)',
        aliases: ['https', 'port'],
        visible: httpsOn,
        control: { type: 'number', key: 'httpsPort', placeholder: '3444', validate: validatePort }
      },
      {
        name: 'Auto-generate certificate',
        desc: 'Automatically generate a self-signed certificate if none exists',
        aliases: ['https', 'tls', 'certificate'],
        visible: httpsOn,
        control: { type: 'toggle', key: 'certAutoGenerate' }
      },
      {
        name: 'Certificate path',
        desc: 'Path to a custom certificate file (.crt) - leave empty for auto-generated',
        aliases: ['https', 'tls', 'certificate'],
        visible: httpsOn,
        control: { type: 'text', key: 'certPath', placeholder: 'Leave empty for auto-generated' }
      },
      {
        name: 'Key path',
        desc: 'Path to the private key file (.key) - leave empty for auto-generated',
        aliases: ['https', 'tls', 'certificate', 'key'],
        visible: httpsOn,
        control: { type: 'text', key: 'certKeyPath', placeholder: 'Leave empty for auto-generated' }
      },
      {
        name: 'Minimum TLS version',
        desc: 'Minimum TLS version to accept',
        aliases: ['https', 'tls'],
        visible: httpsOn,
        control: {
          type: 'dropdown',
          key: 'certMinTLSVersion',
          options: { 'TLSv1.2': 'TLS 1.2', 'TLSv1.3': 'TLS 1.3' }
        }
      },
      {
        name: 'Certificate status display',
        searchable: false,
        visible: httpsOn,
        render: (setting: Setting) => {
          const container = resetRenderRow(setting);
          const statusEl = container.createDiv('mcp-cert-status');
          statusEl.createEl('p', { text: 'Checking certificate…', cls: 'setting-item-description mcp-security-note' });
          void import('../utils/certificate-manager').then(module => {
            statusEl.empty();
            const certManager = new module.CertificateManager(host.app);
            if (certManager.hasDefaultCertificate()) {
              const paths = certManager.getDefaultPaths();
              const loaded = certManager.loadCertificate(paths.certPath, paths.keyPath);
              if (loaded) {
                const info = certManager.getCertificateInfo(loaded.cert);
                if (info) {
                  statusEl.createEl('p', {
                    text: `✅ Certificate valid until: ${info.validTo.toLocaleDateString()}`,
                    cls: 'setting-item-description mcp-security-note'
                  });
                  if (info.daysUntilExpiry < 30) {
                    statusEl.createEl('p', {
                      text: `⚠️ Certificate expires in ${info.daysUntilExpiry} days`,
                      cls: 'setting-item-description mod-warning'
                    });
                  }
                }
              }
            } else {
              statusEl.createEl('p', {
                text: '📝 No certificate found - will auto-generate on server start',
                cls: 'setting-item-description mcp-security-note'
              });
            }
          });
        }
      }
    ]
  };
}

function authenticationGroup(host: SettingsUIHost): Group {
  return {
    type: 'group',
    heading: 'Authentication',
    items: [
      {
        name: 'Authentication key',
        desc: 'Secure key for authenticating MCP clients',
        aliases: ['api key', 'token', 'bearer', 'scoped token'],
        render: (setting: Setting) => {
          const s = host.settings;
          const notes = resetRenderRow(setting);
          setting.addText(text => {
            const input = text
              .setPlaceholder('API key will be shown here')
              .setValue(s.apiKey)
              .setDisabled(true);
            input.inputEl.classList.add('mcp-api-key-input', 'mcp-monospace-input');
          });
          setting.addButton(button => button
            .setButtonText('Copy')
            .setTooltip('Copy API key to clipboard')
            .onClick(async () => {
              await navigator.clipboard.writeText(s.apiKey);
              new Notice('API key copied to clipboard');
            }));
          setting.addButton(button => button
            .setButtonText('Regenerate')
            .setTooltip('Generate a new API key')
            .setClass('mod-warning')
            .onClick(() => {
              host.confirm(
                'Are you sure you want to regenerate the API key? This will invalidate the current key and require updating all MCP clients.',
                async () => {
                  s.apiKey = host.generateApiKey();
                  await host.saveSettings();
                  new Notice('API key regenerated. Update your MCP clients with the new key.');
                  host.update();
                }
              );
            }));
          notes.createEl('p', {
            text: 'Note: the API key is stored in the plugin settings file. Anyone with access to your vault can read it.',
            cls: 'setting-item-description mcp-security-note'
          });
          notes.createEl('p', {
            text: 'Supports both bearer token (recommended) and basic authentication.',
            cls: 'setting-item-description mcp-security-note'
          });
        }
      },
      {
        name: 'Disable authentication',
        desc: '⚠️ dangerous: disable authentication entirely. Only use for testing or if you fully trust your local environment.',
        aliases: ['auth', 'dangerously'],
        control: { type: 'toggle', key: 'dangerouslyDisableAuth' }
      },
      {
        name: 'Scoped tokens',
        desc: 'Extra keys for mcp clients. Each key can be limited to one folder of the vault and to read-only access. A key without a folder has the same access as the main key. Scope changes apply to new sessions.',
        aliases: ['scoped token', 'token', 'folder', 'read-only']
      }
    ]
  };
}

/** The scoped tokens list: framework-rendered add/delete affordances. */
function scopedTokensList(host: SettingsUIHost): SettingDefinitionList {
  return {
    type: 'list',
    heading: 'Scoped tokens',
    emptyState: 'No scoped tokens. The main key above has full access.',
    items: host.settings.scopedTokens.map((token): SettingGroupItem => ({
      name: token.name || 'Scoped token',
      desc: `Folder: ${token.folder ?? 'whole vault'}${token.readOnly === true ? ' — read-only' : ''}`,
      searchable: false,
      render: (setting: Setting) => {
        const block = resetRenderRow(setting);
        // The framework's delete stays in the control area, top right. The
        // editable fields live in the full-width block below: as
        // label+control pairs that wrap as units, they get the whole row
        // width instead of squeezing the half-width control column.
        const fields = block.createDiv('mcp-token-fields');
        const field = (label: string): HTMLElement => {
          const pair = fields.createDiv('mcp-token-field');
          pair.createSpan({ text: label, cls: 'mcp-inline-label' });
          return pair;
        };

        const nameField = field('Name');
        setting.addText(text => {
          text
            .setPlaceholder('Scope name')
            .setValue(token.name)
            .onChange(async (value) => {
              token.name = value;
              await host.saveSettings();
            });
          nameField.appendChild(text.inputEl);
        });

        const folderField = field('Folder');
        setting.addText(text => {
          text
            .setPlaceholder('Folder (empty = whole vault)')
            .setValue(token.folder ?? '')
            .onChange(async (value) => {
              const folder = value.trim().replace(/^\/+|\/+$/g, '');
              token.folder = folder || undefined;
              await host.saveSettings();
            });
          folderField.appendChild(text.inputEl);
          // Hierarchical autocomplete on the scope folder: root folders on an
          // empty field, then ancestors and children of the current value.
          // The input stays freely editable; this only drives the popover.
          // A pick writes the field, so the onChange above does the saving.
          const folders = host.app.vault.getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder)
            .map(f => f.path)
            .sort();
          new FolderScopeSuggest(host.app, text.inputEl, folders);
        });

        // The toggle component carries only a tooltip; give it a visible
        // label so the affordance is readable without hovering.
        const readOnlyField = field('Read-only');
        setting.addToggle(toggle => {
          toggle
            .setTooltip('Read-only: this key cannot change the vault')
            .setValue(token.readOnly === true)
            .onChange(async (value) => {
              token.readOnly = value || undefined;
              await host.saveSettings();
            });
          readOnlyField.appendChild(toggle.toggleEl);
        });

        // The token value on its own full-width line below the fields, in a
        // disabled input with Copy beside it — the button sits next to the
        // thing it copies, like the Authentication key row.
        const valueRow = block.createDiv('mcp-token-value-row');
        const tokenDisplay = valueRow.createEl('input', {
          type: 'text',
          cls: 'mcp-monospace-input mcp-token-display',
          attr: { 'aria-label': 'Scoped token value (read-only)' }
        });
        tokenDisplay.value = token.token;
        tokenDisplay.disabled = true;
        let copyButton: ButtonComponent;
        setting.addButton(button => {
          copyButton = button
            .setButtonText('Copy')
            .setTooltip('Copy token to clipboard')
            .onClick(async () => {
              await navigator.clipboard.writeText(token.token);
              new Notice('Token copied to clipboard');
            });
        });
        valueRow.appendChild(copyButton!.buttonEl);
      }
    })),
    addItem: {
      name: 'Add scoped token',
      action: () => {
        host.settings.scopedTokens.push({ name: '', token: host.generateApiKey() });
        void host.saveSettings().then(() => host.update());
      }
    },
    onDelete: (index: number) => {
      host.confirm(
        'Are you sure you want to delete this token? MCP clients using it lose access on their next request.',
        async () => {
          host.settings.scopedTokens.splice(index, 1);
          await host.saveSettings();
          new Notice('Token deleted.');
          host.update();
        }
      );
    }
  };
}

function securityGroup(host: SettingsUIHost): Group {
  const exclusionsOn = () => host.settings.pathExclusionsEnabled;
  return {
    type: 'group',
    heading: 'Security',
    items: [
      {
        name: 'Read-only mode',
        desc: 'Blocks every operation that changes the vault. Reads, searches, graph queries and opening notes still work. Takes effect immediately — no restart needed.',
        aliases: ['readonly', 'read only', 'writes'],
        control: { type: 'toggle', key: 'readOnlyMode' }
      },
      {
        name: 'Allow outbound web fetch',
        desc: 'Lets connected agents fetch web pages (system.fetch_web). Off: the plugin makes no outbound connections at all. On: internal addresses (localhost, local network, cloud metadata) are always blocked, but an agent reading untrusted notes could still be tricked into leaking vault data inside a URL to a public site — read-only mode does not prevent that. Enforcement takes effect immediately; agents see the tool appear on their next connection.',
        aliases: ['web', 'fetch', 'fetch_web', 'internet'],
        control: { type: 'toggle', key: 'enableWebFetch' }
      },
      {
        name: 'Path exclusions',
        desc: 'Exclude files and directories from MCP operations using .gitignore-style patterns',
        aliases: ['mcpignore', 'ignore', 'exclude'],
        control: { type: 'toggle', key: 'pathExclusionsEnabled' }
      },
      {
        name: 'Enable right-click context menu',
        desc: 'Add an "add to .mcpignore" option to file and folder context menus',
        aliases: ['context menu', 'mcpignore'],
        visible: exclusionsOn,
        control: { type: 'toggle', key: 'enableIgnoreContextMenu' }
      },
      {
        name: '.mcpignore file management',
        searchable: false,
        visible: exclusionsOn,
        render: (setting: Setting) => {
          const ignoreManager = host.ignoreManager;
          const container = resetRenderRow(setting);
          if (!ignoreManager) return;
          const exclusionSection = container.createDiv('mcp-exclusion-section');
          const stats = ignoreManager.getStats();

          const statusEl = exclusionSection.createDiv('mcp-exclusion-status');
          statusEl.createEl('p', {
            text: `Current exclusions: ${stats.patternCount} patterns active`,
            cls: 'setting-item-description mcp-security-note'
          });
          statusEl.createEl('p', {
            text: 'Save patterns in .mcpignore file before reloading',
            cls: 'setting-item-description mcp-security-note'
          });
          if (stats.lastModified > 0) {
            statusEl.createEl('p', {
              text: `Last modified: ${new Date(stats.lastModified).toLocaleString()}`,
              cls: 'setting-item-description mcp-security-note'
            });
          }

          const openPath = async (open: (shell: { openPath?: (p: string) => Promise<string>; showItemInFolder?: (p: string) => void }, fullPath: string) => Promise<void>, failureNotice: string) => {
            try {
              const exists = await ignoreManager.ignoreFileExists();
              if (!exists) {
                await ignoreManager.createDefaultIgnoreFile();
              }
              const adapter = host.app.vault.adapter;
              const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
              // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require needed for Node.js path module in Obsidian desktop environment
              const nodePath = require('path') as typeof import('path');
              const fullPath = nodePath.join(basePath, stats.filePath);
              // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require needed for Electron shell API in Obsidian desktop environment
              const electron = require('electron') as { shell?: { openPath: (path: string) => Promise<string>; showItemInFolder: (path: string) => void } };
              if (electron?.shell) {
                await open(electron.shell, fullPath);
              } else {
                new Notice('❌ System integration not available');
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              Debug.log(`${failureNotice}: ${message}`);
              new Notice(`❌ ${failureNotice}`);
            }
          };

          const buttonContainer = exclusionSection.createDiv('mcp-exclusion-buttons');
          const openButton = buttonContainer.createEl('button', { text: 'Open in default app' });
          openButton.addEventListener('click', () => {
            void openPath(async (shell, fullPath) => {
              await shell.openPath?.(fullPath);
              new Notice('📝 .mcpignore file opened in default app');
            }, 'Failed to open .mcpignore file');
          });
          const showButton = buttonContainer.createEl('button', { text: 'Show in system explorer' });
          showButton.addEventListener('click', () => {
            void openPath(async (shell, fullPath) => {
              shell.showItemInFolder?.(fullPath);
              new Notice('📁 .mcpignore file location shown in explorer');
            }, 'Failed to show file location');
          });
          const templateButton = buttonContainer.createEl('button', { text: 'Create template' });
          templateButton.addEventListener('click', () => {
            void (async () => {
              try {
                if (await ignoreManager.ignoreFileExists()) {
                  new Notice('⚠️ .mcpignore file already exists');
                  return;
                }
                await ignoreManager.createDefaultIgnoreFile();
                await ignoreManager.forceReload();
                new Notice('📄 Default .mcpignore template created');
                host.update();
              } catch (error) {
                Debug.log('Failed to create .mcpignore template:', error);
                new Notice('❌ Failed to create template');
              }
            })();
          });
          const reloadButton = buttonContainer.createEl('button', { text: 'Reload patterns' });
          reloadButton.addEventListener('click', () => {
            void (async () => {
              try {
                await ignoreManager.forceReload();
                new Notice('🔄 Exclusion patterns reloaded');
                host.update();
              } catch (error) {
                Debug.log('Failed to reload patterns:', error);
                new Notice('❌ Failed to reload patterns');
              }
            })();
          });

          const helpEl = exclusionSection.createDiv('mcp-exclusion-help');
          helpEl.createEl('p', { text: 'Pattern examples:', cls: 'setting-item-description' });
          const examplesList = helpEl.createEl('ul');
          const configDir = host.app.vault.configDir;
          const examples = [
            'private/ - exclude entire directory',
            '*.secret - exclude files by extension',
            'temp/** - exclude deeply nested paths',
            '!file.md - include exception (whitelist)',
            `${configDir}/workspace* - exclude workspace files`
          ];
          examples.forEach(example => {
            examplesList.createEl('li', { text: example, cls: 'setting-item-description mcp-security-note' });
          });
          helpEl.createEl('p', {
            text: 'Full syntax documentation: https://Git-scm.com/docs/gitignore',
            cls: 'setting-item-description mcp-security-note'
          });
        }
      }
    ]
  };
}

function toolVisibilityGroup(host: SettingsUIHost): Group {
  const visibilityOps = ALL_OPERATIONS.filter(op => op !== 'dataview' || host.isDataviewAvailable());
  const items: SettingGroupItem[] = [];
  for (const op of visibilityOps) {
    const actions = getActionsForOperation(op).filter(a => !(op === 'system' && a === 'fetch_web'));
    if (actions.length === 0) continue;
    const desc = getOperationDescription(op).replace(/^[^\s]+\s/, ''); // strip leading emoji
    items.push({
      name: op,
      desc: `Show or hide the ${op} tool and all its actions. ${desc}`,
      aliases: ['tool', 'visibility'],
      control: { type: 'toggle', key: `vis.${op}` }
    });
    for (const action of actions) {
      items.push({
        name: `${op}.${action}`,
        desc: `Show or hide the ${action} action of the ${op} tool`,
        aliases: ['tool', 'visibility', op, action],
        control: { type: 'toggle', key: `vis.${op}.${action}` }
      });
    }
    if (op === 'files') {
      items.push({
        name: 'Allow overwrite',
        desc: 'Let files actions replace existing content (overwrite=true)',
        aliases: ['files', 'overwrite'],
        control: { type: 'toggle', key: 'allowCreateOverwrite' }
      });
    }
  }
  return { type: 'group', heading: 'Tool visibility', items };
}

function interfaceGroup(): Group {
  return {
    type: 'group',
    heading: 'Interface',
    items: [
      {
        name: 'Show connection status',
        desc: 'Show MCP server status in the status bar',
        aliases: ['status bar'],
        control: { type: 'toggle', key: 'showConnectionStatus' }
      },
      {
        name: 'Debug logging',
        desc: 'Enable detailed debug logging in console',
        aliases: ['debug', 'logs'],
        control: { type: 'toggle', key: 'debugLogging' }
      }
    ]
  };
}

export function buildSettingsUI(host: SettingsUIHost): SettingDefinitionItem[] {
  return [
    gettingStartedGroup(host),
    connectionStatusGroup(host),
    serverConfigGroup(host),
    networkBindingGroup(host),
    secureTransportGroup(host),
    authenticationGroup(host),
    scopedTokensList(host),
    securityGroup(host),
    toolVisibilityGroup(host),
    interfaceGroup()
  ];
}
