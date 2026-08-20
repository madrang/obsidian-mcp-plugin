/**
 * The settings tab renders imperatively, so getSettingDefinitions() is the
 * only thing Obsidian 1.13+ settings search can index. A partial list is
 * worse than none: search would find some settings and silently miss the
 * rest. These tests pin two things:
 *
 *   1. every named row in the tab is declared, with the same visibility
 *      conditions as the render path
 *   2. a drift guard: every setName('...') literal in main.ts maps to a
 *      definition or an explicitly excluded non-setting heading — adding a
 *      setting without declaring it fails here
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSettingDefinitions, SettingsForDefinitions } from '../src/settings-definitions';
import type { SettingDefinitionItem } from 'obsidian';

jest.mock('obsidian');

const BASE: SettingsForDefinitions = {
  bindMode: 'loopback',
  httpsEnabled: false,
  sessionTimeoutMs: 0,
  pathExclusionsEnabled: false,
  scopedTokens: []
};

function evaluateVisible(visible: unknown): boolean {
  if (typeof visible === 'function') return (visible as () => boolean)();
  return visible !== false;
}

/** All item names, respecting visible predicates. */
function visibleItemNames(items: SettingDefinitionItem[]): string[] {
  const names: string[] = [];
  for (const item of items) {
    const maybeGroup = item as { type?: string; heading?: string; items?: Array<{ name: string; visible?: unknown }> };
    if (maybeGroup.type === 'group') {
      for (const child of maybeGroup.items ?? []) {
        if (evaluateVisible(child.visible)) names.push(child.name);
      }
    } else {
      const def = item as { name: string; visible?: unknown };
      if (evaluateVisible(def.visible)) names.push(def.name);
    }
  }
  return names;
}

function groupHeadings(items: SettingDefinitionItem[]): string[] {
  return items
    .map(item => (item as { type?: string; heading?: string }))
    .filter(item => item.type === 'group' && item.heading)
    .map(item => item.heading!);
}

describe('buildSettingDefinitions', () => {
  it('declares every named setting row in the tab', () => {
    const names = visibleItemNames(buildSettingDefinitions(BASE, false));
    const expected = [
      'Enable HTTP server', 'Server port', 'Auto-detect port conflicts',
      'Sessions never expire', 'Sessions per token',
      'Bind address',
      'Enable HTTPS server',
      'Authentication key', 'Disable authentication',
      'Read-only mode', 'Allow outbound web fetch', 'Path exclusions',
      'Allow overwrite',
      'Show connection status', 'Debug logging'
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it('mirrors the render path visibility conditions', () => {
    const off = visibleItemNames(buildSettingDefinitions(BASE, false));
    expect(off).not.toContain('Session timeout in minutes');
    expect(off).not.toContain('Secure port');
    expect(off).not.toContain('Custom bind address');
    expect(off).not.toContain('Enable right-click context menu');

    const on = visibleItemNames(buildSettingDefinitions({
      ...BASE,
      sessionTimeoutMs: 3600000,
      httpsEnabled: true,
      bindMode: 'custom',
      pathExclusionsEnabled: true
    }, false));
    expect(on).toContain('Session timeout in minutes');
    expect(on).toContain('Secure port');
    expect(on).toContain('Certificate path');
    expect(on).toContain('Key path');
    expect(on).toContain('Auto-generate certificate');
    expect(on).toContain('Minimum TLS version');
    expect(on).toContain('Custom bind address');
    expect(on).toContain('Enable right-click context menu');
  });

  it('declares one row per scoped token, with its folder and read-only state', () => {
    const items = buildSettingDefinitions({
      ...BASE,
      scopedTokens: [
        { name: 'Blog reader', token: 'x', folder: 'Projects/Blog', readOnly: true },
        { name: '', token: 'y' }
      ]
    }, false);
    const names = visibleItemNames(items);
    expect(names).toContain('Blog reader');
    expect(names).toContain('Scoped token 2');
  });

  it('lists dataview only when the plugin is available, and never lists fetch_web in the tree', () => {
    const without = visibleItemNames(buildSettingDefinitions(BASE, false));
    expect(without).not.toContain('dataview');
    expect(without).not.toContain('dataview.query');
    expect(without).not.toContain('system.fetch_web');

    const withDataview = visibleItemNames(buildSettingDefinitions(BASE, true));
    expect(withDataview).toContain('dataview');
    expect(withDataview).toContain('dataview.query');
    expect(withDataview).not.toContain('system.fetch_web');
  });

  it('covers every setName literal in main.ts (drift guard)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
    const literals = new Set<string>();
    for (const match of source.matchAll(/setName\(\s*'([^']*)'/g)) literals.add(match[1]);
    for (const match of source.matchAll(/setName\(\s*"([^"]*)"/g)) literals.add(match[1]);

    // Headings that are displays, guides, or help text — not settings. A new
    // entry here must carry its reason, same as the row it excuses.
    const notSettings = new Set([
      '',                                              // spacer headings
      'Connection status',                             // live server status display
      'Certificate status',                            // certificate info display
      '.mcpignore file management',                    // file action buttons
      'Pattern examples:',                             // help text
      'Getting started — connect a client',            // setup guide
      'MCP bundle (.mcpb — one-click install)',        // setup guide
      'Any MCP client (JSON config)',                  // setup guide
      'Custom bundle per vault'                        // setup guide
    ]);

    const items = buildSettingDefinitions({
      ...BASE,
      sessionTimeoutMs: 3600000,
      httpsEnabled: true,
      bindMode: 'custom',
      pathExclusionsEnabled: true
    }, true);
    const covered = new Set([...visibleItemNames(items), ...groupHeadings(items)]);

    const missing = [...literals].filter(name => !notSettings.has(name) && !covered.has(name));
    expect(missing).toEqual([]);
  });
});
