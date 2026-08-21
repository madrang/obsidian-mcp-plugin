/**
 * The settings tab renders entirely from buildSettingsUI (Obsidian 1.13+;
 * there is no imperative fallback). These tests pin the structure: every
 * setting has its control row with the right key, visibility predicates
 * mirror the old conditional rendering, validators reject bad input, and the
 * scoped-tokens list wires its add/delete affordances.
 */
import { App } from 'obsidian';
import { buildSettingsUI, SettingsUIHost } from '../src/settings/ui';
import { DEFAULT_SETTINGS, MCPPluginSettings } from '../src/settings/plugin-settings';
import { ALL_OPERATIONS, getActionsForOperation } from '../src/tools/semantic-tools';
import type { SettingDefinitionItem } from 'obsidian';

jest.mock('obsidian');

interface FlatItem {
  name?: string;
  type?: string;
  heading?: string;
  visible?: unknown;
  searchable?: unknown;
  control?: { key?: string; validate?: (value: number) => string | void };
  items?: FlatItem[];
  addItem?: { name: string; action: () => void };
  onDelete?: (index: number) => void;
}

function flatten(items: SettingDefinitionItem[]): FlatItem[] {
  const out: FlatItem[] = [];
  for (const item of items as unknown as FlatItem[]) {
    out.push(item);
    if (item.items) out.push(...item.items);
  }
  return out;
}

function isVisible(item: FlatItem): boolean {
  if (typeof item.visible === 'function') return (item.visible as () => boolean)();
  return item.visible !== false;
}

function visibleControlKeys(items: SettingDefinitionItem[]): string[] {
  return flatten(items)
    .filter(i => i.control?.key && isVisible(i))
    .map(i => i.control!.key!);
}

function makeHost(overrides: Partial<MCPPluginSettings> = {}) {
  const settings: MCPPluginSettings = { ...DEFAULT_SETTINGS, ...overrides };
  const calls: string[] = [];
  const host: SettingsUIHost = {
    app: { vault: { getName: () => 'TestVault', configDir: '.obsidian' } } as unknown as App,
    settings,
    saveSettings: async () => { calls.push('save'); },
    generateApiKey: () => 'generated-key',
    getServerInfo: () => undefined,
    restartIfRunning: async () => { calls.push('restart'); },
    applyCustomBindHost: async () => { calls.push('applyBind'); },
    notifyToolListChanged: () => { calls.push('notify'); },
    updateStatusBar: () => { calls.push('statusbar'); },
    registerContextMenu: () => { calls.push('ctxmenu'); },
    confirm: (_msg, cb) => { calls.push('confirm'); void cb(); },
    onVersionClick: () => undefined,
    isDataviewAvailable: () => false,
    dataviewVersion: () => '0.0.0',
    update: () => { calls.push('update'); }
  };
  return { host, settings, calls };
}

describe('buildSettingsUI', () => {
  it('declares a control row for every setting key', () => {
    const { host } = makeHost({
      httpsEnabled: true,
      bindMode: 'custom',
      sessionTimeoutMs: 3600000,
      pathExclusionsEnabled: true
    });
    const keys = visibleControlKeys(buildSettingsUI(host));

    const plainKeys = [
      'httpEnabled', 'httpPort', 'autoDetectPortConflicts',
      'sessionsNeverExpire', 'sessionTimeoutMinutes', 'sessionsPerToken',
      'bindMode', 'customBindHost',
      'httpsEnabled', 'httpsPort', 'certAutoGenerate', 'certPath', 'certKeyPath', 'certMinTLSVersion',
      'dangerouslyDisableAuth',
      'readOnlyMode', 'enableWebFetch', 'pathExclusionsEnabled', 'enableIgnoreContextMenu',
      'allowCreateOverwrite',
      'showConnectionStatus', 'debugLogging'
    ];
    for (const key of plainKeys) {
      expect(keys).toContain(key);
    }

    // Every operation and action gets a visibility toggle except
    // system.fetch_web (its dedicated gate lives in the security group).
    for (const op of ALL_OPERATIONS.filter(o => o !== 'dataview')) {
      expect(keys).toContain(`vis.${op}`);
      for (const action of getActionsForOperation(op)) {
        if (op === 'system' && action === 'fetch_web') {
          expect(keys).not.toContain('vis.system.fetch_web');
        } else {
          expect(keys).toContain(`vis.${op}.${action}`);
        }
      }
    }
  });

  it('mirrors the conditional-row visibility of the old render path', () => {
    const off = visibleControlKeys(buildSettingsUI(makeHost().host));
    expect(off).not.toContain('sessionTimeoutMinutes');
    expect(off).not.toContain('httpsPort');
    expect(off).not.toContain('customBindHost');
    expect(off).not.toContain('enableIgnoreContextMenu');

    const on = visibleControlKeys(buildSettingsUI(makeHost({
      sessionTimeoutMs: 3600000, httpsEnabled: true, bindMode: 'custom', pathExclusionsEnabled: true
    }).host));
    for (const key of ['sessionTimeoutMinutes', 'httpsPort', 'customBindHost', 'enableIgnoreContextMenu']) {
      expect(on).toContain(key);
    }
  });

  it('the port validator rejects out-of-range values and accepts a good one', () => {
    const { host } = makeHost();
    const portRow = flatten(buildSettingsUI(host))
      .find(i => i.control?.key === 'httpPort');
    const validate = portRow!.control!.validate!;
    expect(validate(0)).toBeTruthy();
    expect(validate(70000)).toBeTruthy();
    expect(validate(1.5)).toBeTruthy();
    expect(validate(3011)).toBeUndefined();
  });

  it('renders the custom blocks as searchable:false render rows', () => {
    const { host } = makeHost();
    const renders = flatten(buildSettingsUI(host)).filter(i => 'render' in i);
    expect(renders.length).toBeGreaterThanOrEqual(5); // guide, status, badge, auth key, token editors
    for (const row of renders) {
      // The Authentication key row is a real setting with a custom layout;
      // it stays searchable. The pure displays do not.
      if (row.name === 'Authentication key') continue;
      expect(row.searchable).toBe(false);
    }
  });

  it('the scoped tokens list has one row per token plus add/delete affordances', async () => {
    const { host, settings, calls } = makeHost({
      scopedTokens: [
        { name: 'Blog reader', token: 'a', folder: 'Projects/Blog', readOnly: true },
        { name: '', token: 'b' }
      ]
    });
    const list = (buildSettingsUI(host) as unknown as FlatItem[]).find(i => i.type === 'list')!;
    expect(list.items).toHaveLength(2);

    // Add: pushes a token, saves, and re-reads the definitions.
    list.addItem!.action();
    await Promise.resolve();
    expect(settings.scopedTokens).toHaveLength(3);
    expect(settings.scopedTokens[2].token).toBe('generated-key');

    // Delete: confirms, splices, saves, re-reads. The fake confirm auto-accepts.
    list.onDelete!(0);
    await Promise.resolve();
    expect(calls).toContain('confirm');
    expect(settings.scopedTokens).toHaveLength(2);
    expect(settings.scopedTokens[0].token).toBe('b');
    expect(calls).toContain('update');
  });

  it('lists dataview only when the plugin is available', () => {
    const without = visibleControlKeys(buildSettingsUI(makeHost().host));
    expect(without).not.toContain('vis.dataview');

    const withDataview = visibleControlKeys(buildSettingsUI({
      ...makeHost().host,
      isDataviewAvailable: () => true
    }));
    expect(withDataview).toContain('vis.dataview');
    expect(withDataview).toContain('vis.dataview.query');
  });

  it('every named row has a non-empty name', () => {
    const { host } = makeHost();
    for (const item of flatten(buildSettingsUI(host))) {
      if (item.type === 'group' || item.type === 'list') continue;
      expect(typeof item.name === 'string' && item.name.length > 0).toBe(true);
    }
  });
});
