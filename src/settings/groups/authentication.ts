/** Authentication: the API key row, the disable toggle, and the scoped tokens list. */
import { ButtonComponent, Notice, Setting, TFolder } from 'obsidian';
import type { SettingGroupItem, SettingDefinitionList } from 'obsidian';
import { FolderScopeSuggest } from '../folder-suggest';
import type { TokenScope } from '../../security/http-auth';
import type { SettingsUIHost } from '../host-types';
import { resetRenderRow, Group } from '../ui-helpers';

export function authenticationGroup(host: SettingsUIHost): Group {
  return {
    type: 'group'
    , heading: 'Authentication'
    , items: [
      {
        name: 'Authentication key'
        , desc: 'Secure key for authenticating MCP clients'
        , aliases: ['api key', 'token', 'bearer', 'scoped token']
        , render: (setting: Setting) => {
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
            text: 'Note: the API key is stored in the plugin settings file. Anyone with access to your vault can read it.'
            , cls: 'setting-item-description mcp-security-note'
          });
          notes.createEl('p', {
            text: 'Supports both bearer token (recommended) and basic authentication.'
            , cls: 'setting-item-description mcp-security-note'
          });
        }
      }
      , {
        name: 'Disable authentication'
        , desc: '⚠️ dangerous: disable authentication entirely. Only use for testing or if you fully trust your local environment.'
        , aliases: ['auth', 'dangerously']
        , control: { type: 'toggle', key: 'dangerouslyDisableAuth' }
      }
      , {
        name: 'Scoped tokens'
        , desc: 'Extra keys for mcp clients. Each scope limits the key to one folder and can be read-only on its own; a key with no scope reaches the whole vault. Reference pages under obsidian://resources/ stay readable for every scoped key. Scope changes apply to new sessions.'
        , aliases: ['scoped token', 'token', 'folder', 'read-only']
      }
    ]
  };
}

/** One-line scope summary for the token row. */
function describeScopes(token: { scopes?: TokenScope[] }): string {
  const scopes = token.scopes ?? [];
  if (scopes.length === 0) return 'Whole vault';
  return scopes
    .map(scope => {
      const folder = scope.folder === '/' ? 'whole vault' : (scope.folder ?? '');
      return `${folder}${scope.readOnly === true ? ' — read-only' : ''}`;
    })
    .join(' | ');
}

/** The scoped tokens list: framework-rendered add/delete affordances. */
export function scopedTokensList(host: SettingsUIHost): SettingDefinitionList {
  return {
    type: 'list'
    , heading: 'Scoped tokens'
    , emptyState: 'No scoped tokens. The main key above has full access.'
    , items: host.settings.scopedTokens.map((token): SettingGroupItem => ({
      name: token.name || 'Scoped token'
      , desc: describeScopes(token)
      , searchable: false
      , render: (setting: Setting) => {
        const block = resetRenderRow(setting);
        // The framework's delete stays in the control area, top right. The
        // editable fields live in the full-width block below: as
        // label+control pairs that wrap as units, they get the whole row
        // width instead of squeezing the half-width control column.
        const fields = block.createDiv('mcp-token-fields');
        const field = (label: string, into: HTMLElement): HTMLElement => {
          const pair = into.createDiv('mcp-token-field');
          pair.createSpan({ text: label, cls: 'mcp-inline-label' });
          return pair;
        };

        const nameField = field('Name', fields);
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

        // Scope rows: one per configured scope, plus one always-empty zone
        // underneath. Typing a folder in the empty zone materializes a new
        // scope and re-renders so another empty zone appears; the zone never
        // materializes on an empty input. Clearing a materialized folder
        // removes the scope. Every scope carries a folder — "/" is the vault
        // root — and no scopes at all means the whole vault with full access.
        // Each scope renders in its own field line, the same label+control
        // flow the name row uses.
        const folders = host.app.vault.getAllLoadedFiles()
          .filter((f): f is TFolder => f instanceof TFolder)
          .map(f => f.path)
          .sort();

        const renderScopeRow = (scope: TokenScope | undefined, index: number): void => {
          const row = block.createDiv('mcp-token-fields');

          const folderField = field('Folder', row);
          setting.addText(text => {
            text
              .setPlaceholder('Folder (/ = whole vault)')
              .setValue(scope?.folder ?? '')
              .onChange(async (value) => {
                const trimmed = value.trim();
                if (scope === undefined) {
                  if (trimmed === '') return;
                  const folder = trimmed.replace(/^\/+|\/+$/g, '') || '/';
                  token.scopes = [...(token.scopes ?? []), { folder }];
                  await host.saveSettings();
                  host.update();
                  return;
                }
                if (trimmed === '') {
                  // An emptied folder removes the scope; the always-present
                  // empty zone below keeps the affordance alive.
                  token.scopes = (token.scopes ?? []).filter((_, i) => i !== index);
                  await host.saveSettings();
                  host.update();
                  return;
                }
                scope.folder = trimmed.replace(/^\/+|\/+$/g, '') || '/';
                await host.saveSettings();
              });
            folderField.appendChild(text.inputEl);
            // Hierarchical autocomplete on the scope folder: root folders on an
            // empty field, then ancestors and children of the current value.
            // The input stays freely editable; this only drives the popover.
            // A pick writes the field, so the onChange above does the saving.
            new FolderScopeSuggest(host.app, text.inputEl, folders);
          });

          // The toggle component carries only a tooltip; give it a visible
          // label so the affordance is readable without hovering.
          const readOnlyField = field('Read-only', row);
          setting.addToggle(toggle => {
            toggle
              .setTooltip('Read-only: this scope cannot be changed')
              .setValue(scope?.readOnly === true)
              .onChange(async (value) => {
                if (scope === undefined) return;
                scope.readOnly = value || undefined;
                await host.saveSettings();
              });
            readOnlyField.appendChild(toggle.toggleEl);
          });

          if (scope !== undefined) {
            setting.addButton(button => {
              button
                .setButtonText('Remove scope')
                .setTooltip('Remove this scope from the token')
                .onClick(async () => {
                  token.scopes = (token.scopes ?? []).filter((_, i) => i !== index);
                  await host.saveSettings();
                  host.update();
                });
              row.appendChild(button.buttonEl);
            });
          }
        };

        for (const [index, scope] of (token.scopes ?? []).entries()) {
          renderScopeRow(scope, index);
        }
        // The always-present empty zone.
        renderScopeRow(undefined, token.scopes?.length ?? 0);

        // The token value on its own full-width line below the fields, in a
        // disabled input with Copy beside it — the button sits next to the
        // thing it copies, like the Authentication key row.
        const valueRow = block.createDiv('mcp-token-value-row');
        const tokenDisplay = valueRow.createEl('input', {
          type: 'text'
          , cls: 'mcp-monospace-input mcp-token-display'
          , attr: { 'aria-label': 'Scoped token value (read-only)' }
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
    }))
    , addItem: {
      name: 'Add scoped token'
      , action: () => {
        host.settings.scopedTokens.push({ name: '', token: host.generateApiKey() });
        void host.saveSettings().then(() => host.update());
      }
    }
    , onDelete: (index: number) => {
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
