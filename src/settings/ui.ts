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
 *
 * The groups live in ./groups/, one file per topic; the shared row,
 * description, and validator helpers live in ./ui-helpers.ts. This module
 * is the composition root.
 */
import type { SettingDefinitionItem } from 'obsidian';
import type { SettingsUIHost } from './host-types';
import { gettingStartedGroup } from './groups/getting-started';
import { connectionStatusGroup } from './groups/connection-status';
import { serverConfigGroup } from './groups/server-config';
import { networkBindingGroup } from './groups/network-binding';
import { secureTransportGroup } from './groups/secure-transport';
import { authenticationGroup, scopedTokensList } from './groups/authentication';
import { securityGroup } from './groups/security';
import { toolVisibilityGroups } from './groups/tool-visibility';
import { interfaceGroup } from './groups/interface';

export type { SettingsUIHost };
export { renderJsonConfigBlock } from './ui-helpers';

export function buildSettingsUI(host: SettingsUIHost): SettingDefinitionItem[] {
  return [
    gettingStartedGroup(host)
    , connectionStatusGroup(host)
    , serverConfigGroup(host)
    , networkBindingGroup(host)
    , secureTransportGroup(host)
    , authenticationGroup(host)
    , scopedTokensList(host)
    , securityGroup(host)
    , ...toolVisibilityGroups(host)
    , interfaceGroup()
  ];
}
