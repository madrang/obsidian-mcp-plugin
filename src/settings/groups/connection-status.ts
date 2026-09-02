/** Live server status grid. A display, not a setting. */
import { Setting } from 'obsidian';
import type { SettingsUIHost } from '../host-types';
import { resetRenderRow, Group } from '../ui-helpers';

export function connectionStatusGroup(host: SettingsUIHost): Group {
  return {
    type: 'group'
    , heading: 'Connection status'
    , items: [{
      name: 'Server status display'
      , searchable: false
      , render: (setting: Setting) => {
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
        // The row keeps its grid slot: text when stopped, unknown for the
        // -1 sentinel, otherwise the count.
        const connectionsText = !info.running
          ? 'Server stopped'
          : info.connections >= 0 ? info.connections.toString() : 'unknown';
        createStatusItem('Connections', connectionsText);
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
