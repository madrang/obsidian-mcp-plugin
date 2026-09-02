/** Security: read-only, gated write namespaces, web fetch, path exclusions. */
import { FileSystemAdapter, Notice, Setting } from 'obsidian';
import { Debug } from '../../utils/debug';
import type { SettingsUIHost } from '../host-types';
import { resetRenderRow, Group } from '../ui-helpers';

export function securityGroup(host: SettingsUIHost): Group {
  const exclusionsOn = () => host.settings.pathExclusionsEnabled;
  return {
    type: 'group'
    , heading: 'Security'
    , items: [
      {
        name: 'Read-only mode'
        , desc: 'Blocks every operation that changes the vault. Reads, searches, graph queries and opening notes still work. Takes effect immediately — no restart needed.'
        , aliases: ['readonly', 'read only', 'writes']
        , control: { type: 'toggle', key: 'readOnlyMode' }
      }
      , {
        name: 'Allow outbound web fetch'
        , desc: 'Lets connected agents fetch web pages (system.fetch_web). Off: the plugin makes no outbound connections at all. On: internal addresses (localhost, local network, cloud metadata) are always blocked, but an agent reading untrusted notes could still be tricked into leaking vault data inside a URL to a public site — read-only mode does not prevent that. Enforcement takes effect immediately; agents see the tool appear on their next connection.'
        , aliases: ['web', 'fetch', 'fetch_web', 'internet']
        , control: { type: 'toggle', key: 'enableWebFetch' }
      }
      , {
        name: 'Allow snippet editing'
        , desc: 'Lets agents change CSS snippet files through the obsidian://snippets/ namespace. Reads stay on with the toggle off. A delete is permanent: the snippet folder has no trash. Deleting a snippet that is enabled requires disabling it first through obsidian://config/enabledCssSnippets. Takes effect immediately.'
        , aliases: ['snippets', 'css', 'obsidian snippets']
        , control: { type: 'toggle', key: 'allowSnippetEditing' }
      }
      , {
        name: 'Allow config editing'
        , desc: 'Lets agents change app settings through the obsidian://config/ namespace. Reads stay on with the toggle off. Every value travels as JSON text, and a write that is not valid JSON is refused. A write applies live where the app exposes a handler for it, and when Obsidian next loads the setting otherwise. Takes effect immediately.'
        , aliases: ['config', 'settings', 'getconfig', 'setconfig']
        , control: { type: 'toggle', key: 'allowConfigEditing' }
      }
      , {
        name: 'Path exclusions'
        , desc: 'Exclude files and directories from MCP operations using .gitignore-style patterns'
        , aliases: ['mcpignore', 'ignore', 'exclude']
        , control: { type: 'toggle', key: 'pathExclusionsEnabled' }
      }
      , {
        name: 'Enable right-click context menu'
        , desc: 'Add an "add to .mcpignore" option to file and folder context menus'
        , aliases: ['context menu', 'mcpignore']
        , visible: exclusionsOn
        , control: { type: 'toggle', key: 'enableIgnoreContextMenu' }
      }
      , {
        name: '.mcpignore file management'
        , searchable: false
        , visible: exclusionsOn
        , render: (setting: Setting) => {
          const ignoreManager = host.ignoreManager;
          const container = resetRenderRow(setting);
          if (!ignoreManager) return;
          const exclusionSection = container.createDiv('mcp-exclusion-section');
          const stats = ignoreManager.getStats();

          const statusEl = exclusionSection.createDiv('mcp-exclusion-status');
          statusEl.createEl('p', {
            text: `Current exclusions: ${stats.patternCount} patterns active`
            , cls: 'setting-item-description mcp-security-note'
          });
          statusEl.createEl('p', {
            text: 'Save patterns in .mcpignore file before reloading'
            , cls: 'setting-item-description mcp-security-note'
          });
          if (stats.lastModified > 0) {
            statusEl.createEl('p', {
              text: `Last modified: ${new Date(stats.lastModified).toLocaleString()}`
              , cls: 'setting-item-description mcp-security-note'
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
            'private/ - exclude entire directory'
            , '*.secret - exclude files by extension'
            , 'temp/** - exclude deeply nested paths'
            , '!file.md - include exception (whitelist)'
            , `${configDir}/workspace* - exclude workspace files`
          ];
          examples.forEach(example => {
            examplesList.createEl('li', { text: example, cls: 'setting-item-description mcp-security-note' });
          });
          helpEl.createEl('p', {
            text: 'Full syntax documentation: https://Git-scm.com/docs/gitignore'
            , cls: 'setting-item-description mcp-security-note'
          });
        }
      }
    ]
  };
}
