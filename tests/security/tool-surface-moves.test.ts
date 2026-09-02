/**
 * The moved tool-surface actions.
 *
 * Several actions of the old vault tool have moved to a new home on the
 * tool surface: read, search, and fragments are now actions of the view
 * tool, update is create with overwrite=true, rename is move with a bare destination,
 * and combine/concatenate is files.concat. What is left of vault is renamed
 * files. All of them route internally through shared handlers, so the
 * security layer and formatters see consistent behavior.
 *
 * What must hold:
 *   1. enumeration — the new homes are advertised. The files enum no longer
 *      contains the moved actions
 *   2. dispatch    — actions the schema does not advertise get INVALID_ACTION,
 *                    not silent execution (enumeration and dispatch must agree)
 *   3. function    — the moved actions still read, search, write, and move
 *   4. visibility  — the moved actions gate on their new keys
 */
import { SecureObsidianAPI, VaultSecurityManager } from '../../src/security';
import { createTools, getActionsForOperation } from '../../src/tools/tool-factory';
import { BASELINE_SECURITY_SETTINGS } from '../../src/security/baseline-settings';
import { App, TFile } from 'obsidian';

jest.mock('obsidian');

type Write = { op: string; path: string };

function mkFile(p: string): TFile {
  const f = new TFile();
  const w = f as unknown as { path: string; extension: string; name: string };
  w.path = p;
  w.extension = 'md';
  w.name = p;
  return f;
}

function makeApp(writes: Write[], paths: string[] = ['note.md']): App {
  return {
    vault: {
      adapter: { basePath: '/test/vault' },
      getAbstractFileByPath: (p: string) => (paths.includes(p) ? mkFile(p) : null),
      read: async () => 'body\n',
      cachedRead: async () => 'body\n',
      modify: async (f: TFile) => { writes.push({ op: 'modify', path: f.path }); },
      create: async (p: string) => { writes.push({ op: 'create', path: p }); return mkFile(p); },
      getFiles: () => paths.map(mkFile),
    },
    fileManager: {
      renameFile: async (_f: TFile, n: string) => { writes.push({ op: 'rename', path: n }); },
      trashFile: async (f: TFile) => { writes.push({ op: 'trash', path: f.path }); },
    },
    metadataCache: { getFileCache: () => ({}), resolvedLinks: {} },
    workspace: {
      getActiveFile: () => mkFile(paths[0]),
      getLeaf: () => ({ openFile: async () => {} }),
    },
  } as unknown as App;
}

function setup(visibility?: Record<string, boolean>, allowCreateOverwrite = true, paths?: string[]) {
  const writes: Write[] = [];
  const plugin = { settings: { readOnlyMode: false, allowCreateOverwrite } };
  const api = new SecureObsidianAPI(
    makeApp(writes, paths), undefined, plugin as never, BASELINE_SECURITY_SETTINGS,
  );
  const tools = createTools(api, visibility, false, allowCreateOverwrite) ?? [];
  return { writes, api, plugin, tools, byName: (n: string) => tools.find(t => t.name === n) };
}

describe('moved tool-surface actions', () => {
  describe('enumeration', () => {
    it('advertises files as a tool alongside edit and view', () => {
      const { tools } = setup(undefined);
      expect(tools.map(t => t.name)).toEqual(
        expect.arrayContaining(['files', 'edit', 'view']),
      );
      expect(tools.map(t => t.name)).not.toContain('read');
    });

    it('advertises folder, read, search, and fragments as view actions', () => {
      const viewActions = getActionsForOperation('view');
      expect(viewActions).toContain('folder');
      expect(viewActions).toContain('read');
      expect(viewActions).toContain('search');
      expect(viewActions).toContain('fragments');
      expect(viewActions).toContain('window');
      expect(viewActions).not.toContain('file');
      expect(viewActions).not.toContain('open_in_obsidian');
    });

    it('no longer advertises the moved actions on files', () => {
      const filesActions = getActionsForOperation('files');
      expect(filesActions).not.toContain('read');
      expect(filesActions).not.toContain('update');
      expect(filesActions).not.toContain('rename');
      expect(filesActions).not.toContain('search');
      expect(filesActions).not.toContain('fragments');
      expect(filesActions).not.toContain('combine');
      expect(filesActions).not.toContain('concatenate');
      expect(filesActions).not.toContain('list');
      expect(filesActions).toContain('create');
      expect(filesActions).toContain('move');
    });

    it('advertises concat as a files action', () => {
      expect(getActionsForOperation('files')).toContain('concat');
    });

    it('keeps the action enum on every tool (no single-action tools remain)', () => {
      const { tools } = setup(undefined);
      for (const tool of tools) {
        const schema = tool.inputSchema as unknown as { properties: Record<string, unknown>; required: string[] };
        expect(schema.properties).toHaveProperty('action');
        expect(schema.required).toEqual(['action']);
      }
    });

    it('carries spec ToolAnnotations that match the read/write split of the surface', () => {
      // files and edit write, view/graph/bases only read, and system reaches
      // the open web through fetch_web (ToolAnnotations, spec 2026-07-28).
      const { byName } = setup(undefined);
      expect(byName('view')!.annotations).toMatchObject({
        readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
      });
      expect(byName('graph')!.annotations).toMatchObject({ readOnlyHint: true });
      expect(byName('bases')!.annotations).toMatchObject({ readOnlyHint: true });
      expect(byName('files')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(byName('edit')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(byName('system')!.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    });
  });

  describe('dispatch of unknown actions', () => {
    // A client calling an action the schema does not advertise — whether it
    // never existed or was moved — gets INVALID_ACTION naming what the schema
    // does offer, never silent execution.
    it('rejects an unknown action with INVALID_ACTION naming the available ones', async () => {
      const { byName, api, writes } = setup(undefined);
      const res = await byName('files')!.handler(api, { action: 'teleport', path: 'note.md' });
      const text = JSON.stringify(res);
      expect(text).toContain('INVALID_ACTION');
      expect(text).toContain('move');
      expect(writes).toEqual([]);
    });
  });

  describe('function', () => {
    it('view.read returns file content through the shared read handler', async () => {
      const { byName, api } = setup(undefined);
      const res = await byName('view')!.handler(api, { action: 'read', path: 'note.md' });
      expect(JSON.stringify(res)).toContain('body');
    });

    it('view.search runs a search through the shared search handler', async () => {
      const { byName, api } = setup(undefined);
      const res = await byName('view')!.handler(api, { action: 'search', query: 'body' });
      // The mock vault has one file whose content is 'body\n' — the search
      // must reach it, and must not come back as an invalid action error.
      const text = JSON.stringify(res);
      expect(text).not.toContain('INVALID_ACTION');
    });

    it('create writes a new file through the shared create handler', async () => {
      const { byName, api, writes } = setup(undefined);
      await byName('files')!.handler(api, { action: 'create', path: 'new.md', content: 'x' });
      expect(writes).toEqual([{ op: 'create', path: 'new.md' }]);
    });

    it('create without the action parameter gets INVALID_ACTION, not a hidden default', async () => {
      // Every tool keeps an action enum, so an omitted action is an error the
      // schema can name, never a silent default.
      const { byName, api, writes } = setup(undefined);
      const res = await byName('files')!.handler(api, { path: 'new.md', content: 'x' });
      expect(JSON.stringify(res)).toContain('INVALID_ACTION');
      expect(writes).toEqual([]);
    });

    it('create refuses an existing file by default and records no write', async () => {
      const { byName, api, writes } = setup(undefined);
      const res = await byName('files')!.handler(api, { action: 'create', path: 'note.md', content: 'x' });
      expect(JSON.stringify(res)).toContain('already exists');
      expect(writes).toEqual([]);
    });

    it('create with overwrite=true replaces an existing file through the UPDATE charge', async () => {
      const { byName, api, writes } = setup(undefined);
      const res = await byName('files')!.handler(api, { action: 'create', path: 'note.md', content: 'x', overwrite: true });
      // modify, not create: the write went through updateFile, and the
      // formatter sees the overwritten marker rather than saying "Created".
      expect(writes).toEqual([{ op: 'modify', path: 'note.md' }]);
      expect(JSON.stringify(res)).toContain('Updated');
    });

    it('move with a bare destination renames in place, carrying the extension', async () => {
      const { byName, api, writes } = setup(undefined);
      await byName('files')!.handler(api, { action: 'move', path: 'note.md', destination: 'renamed' });
      // 'renamed' gained the source's .md extension (#253). The mock records
      // the fileManager primitive Obsidian uses for both move and rename.
      expect(writes).toEqual([{ op: 'rename', path: 'renamed.md' }]);
    });

    it('move with destination still relocates', async () => {
      const { byName, api, writes } = setup(undefined);
      await byName('files')!.handler(api, { action: 'move', path: 'note.md', destination: 'moved/note.md' });
      expect(writes).toEqual([{ op: 'rename', path: 'moved/note.md' }]);
    });

    it('move refuses an existing destination, and overwrite=true overrides', async () => {
      const { byName, api, writes } = setup(undefined, true, ['note.md', 'taken.md']);

      const refused = await byName('files')!.handler(api, { action: 'move', path: 'note.md', destination: 'taken.md' });
      expect(JSON.stringify(refused)).toContain('already exists');
      expect(writes).toEqual([]);

      await byName('files')!.handler(api, { action: 'move', path: 'note.md', destination: 'taken.md', overwrite: true });
      expect(writes).toEqual([{ op: 'rename', path: 'taken.md' }]);
    });

    it('view.folder routes page and pageSize as numbers to the paginated listing', async () => {
      const { byName, api } = setup(undefined);
      const calls: unknown[][] = [];
      api.listFilesPaginated = (async (...args: unknown[]) => {
        calls.push(args);
        return { files: [], totalFiles: 0, totalFolders: 0, page: args[1], pageSize: args[2], totalPages: 0 };
      }) as never;

      await byName('view')!.handler(api, { action: 'folder', path: 'notes', page: 2, pageSize: 5 });

      // The handler fetches the universe once and windows it locally: the
      // caller's page/pageSize drive the content-budget window, not the
      // fetch. The fetch size is an internal detail. The window itself is
      // pinned in view-folder-glob.
      expect(calls).toEqual([['notes', 1, expect.any(Number), true, undefined]]);
    });

    it('view.folder translates path "/" to the vault root', async () => {
      const { byName, api } = setup(undefined);
      const calls: unknown[][] = [];
      api.listFiles = (async (...args: unknown[]) => { calls.push(args); return []; }) as never;

      await byName('view')!.handler(api, { action: 'folder', path: '/' });

      expect(calls).toEqual([[undefined]]);
    });

    it('system.hints returns the default suggestion on an empty context', async () => {
      const { byName, api } = setup(undefined);
      const res = await byName('system')!.handler(api, { action: 'hints' });
      expect(JSON.stringify(res)).toContain('Use workflow hints from other operations');
    });

    it('system.open_in_obsidian opens the file and writes nothing', async () => {
      const { byName, api, writes } = setup(undefined);
      const res = await byName('system')!.handler(api, { action: 'open_in_obsidian', path: 'note.md' });
      const text = JSON.stringify(res);
      expect(text).not.toContain('INVALID_ACTION');
      expect(text).toContain('Opened in Obsidian');
      expect(writes).toEqual([]);
    });

  });

  describe('visibility', () => {
    it('omits view.read from the enum when disabled, keeping the other view actions', () => {
      const { byName } = setup({ 'view.read': false });
      const view = byName('view')!;
      const advertised = (view.inputSchema as unknown as { properties: { action: { enum: string[] } } }).properties.action.enum;
      expect(advertised).not.toContain('read');
      expect(advertised).toContain('window');
      expect(advertised).toContain('search');
    });

    it('omits files.create from the enum when disabled, keeping the other files actions', () => {
      const { byName } = setup({ 'files.create': false });
      const advertised = (byName('files')!.inputSchema as unknown as { properties: { action: { enum: string[] } } }).properties.action.enum;
      expect(advertised).not.toContain('create');
      expect(advertised).toContain('delete');
    });

    it('refuses a live-disabled files.create invocation with ACTION_DISABLED', async () => {
      const visibility: Record<string, boolean> = {};
      const { byName, api, writes } = setup(visibility);
      const files = byName('files')!;

      visibility['files.create'] = false;
      const res = await files.handler(api, { action: 'create', path: 'new.md', content: 'x' });

      expect(writes).toEqual([]);
      expect(JSON.stringify(res)).toContain('ACTION_DISABLED');
    });

    it('denies create with overwrite=true under read-only mode, naming the gate', async () => {
      // Overwrite writes through updateFile, so it is charged UPDATE — and
      // read-only denies UPDATE. A create-only permission grant must never
      // become overwrite access by way of the merged tool.
      const writes: Write[] = [];
      const plugin = { settings: { readOnlyMode: true, allowCreateOverwrite: true } };
      const api = new SecureObsidianAPI(
        makeApp(writes), undefined, plugin as never, VaultSecurityManager.presets.readOnly(),
      );
      const files = (createTools(api) ?? []).find(t => t.name === 'files')!;

      const res = await files.handler(api, { action: 'create', path: 'note.md', content: 'x', overwrite: true });

      expect(writes).toEqual([]);
      expect(JSON.stringify(res)).toMatch(/PERMISSION_DENIED|READ_ONLY_MODE/);
    });
  });

  /**
   * The 'Allow overwrite' settings toggle gates the files tool's overwrite
   * parameter at two layers, the same pattern as fetch_web (ADR-109):
   * enumeration (the parameter leaves the schema) and dispatch (a live
   * settings check refuses overwrite=true, so flipping the toggle applies to
   * sessions that already exist).
   */
  describe('the allow-overwrite gate', () => {
    const hasOverwriteParam = (tool: { inputSchema: unknown } | undefined): boolean => {
      const schema = tool?.inputSchema as { properties: Record<string, unknown> };
      return 'overwrite' in schema.properties;
    };

    it('omits the overwrite parameter from the schema when the gate is off', () => {
      expect(hasOverwriteParam(setup(undefined, false).byName('files'))).toBe(false);
    });

    it('keeps the description in step with the schema', () => {
      // An agent reads the description as available surface (same argument as
      // the fetch_web enumeration test): gated off, the prose must not
      // advertise what the schema omits.
      expect(setup(undefined, false).byName('files')!.description).not.toContain('overwrite');
      // 2026-08-23: the overwrite bullet was removed, so the description stays clean with the gate on too.
      // The schema-side parameter is the only carrier, and it keeps following the gate (the test below).
      expect(setup(undefined, true).byName('files')!.description).not.toContain('overwrite');
    });

    it('advertises the overwrite parameter when the gate is on', () => {
      expect(hasOverwriteParam(setup(undefined, true).byName('files'))).toBe(true);
    });

    it('refuses overwrite=true at dispatch when the gate is off, with no write', async () => {
      const { byName, api, writes } = setup(undefined, false);
      const res = await byName('files')!.handler(api, { action: 'create', path: 'note.md', content: 'x', overwrite: true });
      expect(JSON.stringify(res)).toContain('OVERWRITE_DISABLED');
      expect(writes).toEqual([]);
    });

    it('still creates new files when the gate is off', async () => {
      const { byName, api, writes } = setup(undefined, false);
      await byName('files')!.handler(api, { action: 'create', path: 'new.md', content: 'x' });
      expect(writes).toEqual([{ op: 'create', path: 'new.md' }]);
    });

    it('applies a flipped toggle to a session that already exists', async () => {
      // The tool was built with overwrite allowed. The toggle flips off after.
      // The dispatch check reads the setting live, so the capability is gone
      // without waiting for session eviction or a restart.
      const { byName, api, plugin, writes } = setup(undefined, true);
      const files = byName('files')!;

      await files.handler(api, { action: 'create', path: 'note.md', content: 'x', overwrite: true });
      expect(writes).toEqual([{ op: 'modify', path: 'note.md' }]);

      plugin.settings.allowCreateOverwrite = false;
      const res = await files.handler(api, { action: 'create', path: 'note.md', content: 'y', overwrite: true });

      expect(JSON.stringify(res)).toContain('OVERWRITE_DISABLED');
      expect(writes).toHaveLength(1);
    });
  });
});
