/**
 * Per-action required parameters, advertised and enforced from one map.
 *
 * The flat input schema used to declare only `required: ['action']`, so a
 * client could not tell that files.move needs `destination` or view.search
 * needs `query`. Each definition now carries a requiredParams map, which the
 * factory emits as JSON Schema 2020-12 allOf/if/then conditionals AND the
 * dispatch layer enforces with a coded MISSING_PARAMETER error. One map
 * drives both, so the advertisement and the enforcement cannot drift.
 *
 * requireAnyParams is the one-of counterpart (view.fragments needs path OR
 * query): an anyOf conditional in the schema, the same error code at
 * dispatch.
 */
import { App } from 'obsidian';
import { createTools, ToolDefinition } from '../src/tools/tool-factory';
import { ObsidianAPI } from '../src/utils/obsidian-api';

jest.mock('obsidian');

const makeApp = (): App => ({
  vault: {
    adapter: { basePath: '/test/vault' },
    getAbstractFileByPath: () => null,
    getFiles: () => [],
    getMarkdownFiles: () => []
  },
  metadataCache: { getFileCache: () => null, resolvedLinks: {} },
  workspace: { getActiveFile: () => null }
} as unknown as App);

type Conditional = {
  if: { properties: { action: { const: string } } };
  then: { required?: string[]; anyOf?: Array<{ required: string[] }> };
};

function conditionals(tool: ToolDefinition | undefined): Conditional[] {
  return (tool?.inputSchema.allOf ?? []) as Conditional[];
}

function requiredFor(tool: ToolDefinition | undefined, action: string): string[] | undefined {
  return conditionals(tool).find(c => c.if.properties.action.const === action)?.then.required;
}

describe('per-action required parameters', () => {
  describe('schema conditionals', () => {
    // No api argument: dataview drops out, the six other tools are built.
    const tools = createTools();
    const byName = (name: string) => tools.find(t => t.name === name);

    it('the base required list stays [action]', () => {
      for (const tool of tools) {
        expect(tool.inputSchema.required).toEqual(['action']);
      }
    });

    it('files advertises destination for move and copy but not for create', () => {
      const files = byName('files');
      expect(requiredFor(files, 'move')).toEqual(['path', 'destination']);
      expect(requiredFor(files, 'copy')).toEqual(['path', 'destination']);
      expect(requiredFor(files, 'create')).toEqual(['path']);
      expect(requiredFor(files, 'concat')).toEqual(['paths', 'destination']);
    });

    it('view advertises query only for search, and nothing for active/folder', () => {
      const view = byName('view');
      expect(requiredFor(view, 'search')).toEqual(['query']);
      expect(requiredFor(view, 'window')).toEqual(['path']);
      expect(requiredFor(view, 'lines')).toEqual(['path', 'startLine', 'endLine']);
      expect(requiredFor(view, 'read')).toEqual(['path']);
      expect(requiredFor(view, 'active')).toBeUndefined();
      expect(requiredFor(view, 'folder')).toBeUndefined();
    });

    it('view.fragments advertises the one-of rule as an anyOf conditional', () => {
      const view = byName('view');
      const conditional = conditionals(view).find(c => c.if.properties.action.const === 'fragments');
      expect(conditional?.then.required).toBeUndefined();
      expect(conditional?.then.anyOf).toEqual([
        { required: ['path'] }
        , { required: ['query'] },
      ]);
    });

    it('graph advertises the per-action path and query requirements', () => {
      const graph = byName('graph');
      expect(requiredFor(graph, 'path')).toEqual(['sourcePath', 'targetPath']);
      expect(requiredFor(graph, 'neighbors')).toEqual(['sourcePath']);
      expect(requiredFor(graph, 'statistics')).toBeUndefined();
    });

    it('every conditional names only properties the tool declares', () => {
      for (const tool of tools) {
        for (const c of conditionals(tool)) {
          for (const key of c.then.required ?? []) {
            expect(tool.inputSchema.properties).toHaveProperty(key);
          }
          for (const option of c.then.anyOf ?? []) {
            for (const key of option.required) {
              expect(tool.inputSchema.properties).toHaveProperty(key);
            }
          }
        }
      }
    });

    it('a disabled action drops its conditional along with its enum value', () => {
      const filtered = createTools(undefined, { 'files.move': false });
      const files = filtered.find(t => t.name === 'files');
      const enumActions = (files!.inputSchema.properties.action as { enum: string[] }).enum;
      expect(enumActions).not.toContain('move');
      expect(requiredFor(files, 'move')).toBeUndefined();
    });

    it('fetch_web drops its conditional when the web fetch setting is off', () => {
      const filtered = createTools(undefined, undefined, false);
      const system = filtered.find(t => t.name === 'system');
      expect(requiredFor(system, 'fetch_web')).toBeUndefined();
      expect(requiredFor(system, 'open_in_obsidian')).toEqual(['path']);
    });
  });

  describe('dispatch enforcement', () => {
    const app = makeApp();
    const api = new ObsidianAPI(app);
    const tools = createTools(api);
    const handlerFor = (name: string) => tools.find(t => t.name === name)!.handler;

    async function errorCode(name: string, args: Record<string, unknown>): Promise<string | undefined> {
      const res = await handlerFor(name)(api, args);
      const text = res.content[0].type === 'text' ? res.content[0].text : '';
      try {
        return (JSON.parse(text) as { error?: { code?: string } }).error?.code;
      } catch {
        return undefined;
      }
    }

    it('files.move without destination fails with MISSING_PARAMETER naming destination', async () => {
      const res = await handlerFor('files')(api, { action: 'move', path: 'a.md' });
      expect(res.isError).toBe(true);
      const text = res.content[0].type === 'text' ? res.content[0].text : '';
      expect(text).toContain('MISSING_PARAMETER');
      expect(text).toContain('destination');
    });

    it('view.search without query fails with MISSING_PARAMETER', async () => {
      expect(await errorCode('view', { action: 'search' })).toBe('MISSING_PARAMETER');
    });

    it('graph.path without targetPath fails with MISSING_PARAMETER', async () => {
      expect(await errorCode('graph', { action: 'path', sourcePath: 'a.md' })).toBe('MISSING_PARAMETER');
    });

    it('an empty string counts as missing', async () => {
      expect(await errorCode('view', { action: 'search', query: '' })).toBe('MISSING_PARAMETER');
    });

    it('view.fragments with neither path nor query fails with MISSING_PARAMETER naming both', async () => {
      const res = await handlerFor('view')(api, { action: 'fragments' });
      expect(res.isError).toBe(true);
      const text = res.content[0].type === 'text' ? res.content[0].text : '';
      expect(text).toContain('MISSING_PARAMETER');
      expect(text).toContain('one of');
      expect(text).toContain('path');
      expect(text).toContain('query');
    });

    it('view.fragments with a query satisfies the one-of rule', async () => {
      // The call passes the dispatch check and proceeds into the handler
      // chain; whatever comes back is not a MISSING_PARAMETER.
      expect(await errorCode('view', { action: 'fragments', query: 'deadline' }))
        .not.toBe('MISSING_PARAMETER');
    });

    it('an action with its required params passes the dispatch check', async () => {
      // view.active needs nothing; the call reaches the handler chain and
      // fails only because the mock app has no active file — not on params.
      expect(await errorCode('view', { action: 'active' })).not.toBe('MISSING_PARAMETER');
    });

    it('files.create with only a path passes: content is optional (touch)', async () => {
      // The router reports the missing FILE, not a missing parameter.
      expect(await errorCode('files', { action: 'create', path: 'ghost.md' })).not.toBe('MISSING_PARAMETER');
    });
  });
});
