import { App, TFile } from 'obsidian';
import { BasesAPI } from '../src/utils/bases-api';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { VaultRouter } from '../src/tools/router';

// bases.query caller options (the merged export): structured filters,
// sortBy/sortOrder, page/pageSize, and properties projection, all pinned
// at the BasesAPI level, plus the router mapping from the flat surface
// params onto BaseQueryOptions and the format=serialized routing.

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop()!;
  f.basename = f.name.replace(/\.[^.]+$/, '');
  f.extension = path.split('.').pop()!;
  (f as unknown as { stat: unknown }).stat = { ctime: 0, mtime: 0, size: 10 };
  return f;
}

// alpha: active, priority 1. beta: archived, priority 2. gamma: active, priority 3.
// Insertion order (beta, gamma, alpha) differs from priority order on
// purpose: it proves an order-only view does not sort the notes.
const FILES = new Map<string, TFile>([
  ['dash.base', makeFile('dash.base')],
  ['beta.md', makeFile('beta.md')],
  ['gamma.md', makeFile('gamma.md')],
  ['alpha.md', makeFile('alpha.md')],
]);

const FRONTMATTER: Record<string, Record<string, unknown>> = {
  'alpha.md': { status: 'active', priority: 1 },
  'beta.md': { status: 'archived', priority: 2 },
  'gamma.md': { status: 'active', priority: 3 },
};

// plain: order only, no sort. main: native sort ASC. desc: native sort
// DESC. legacy: the `column:` entry spelling written by older Obsidian.
const BASE_YAML = [
  'views:'
  , '  - name: plain'
  , '    order:'
  , '      - status'
  , '      - priority'
  , '  - name: main'
  , '    order:'
  , '      - status'
  , '      - priority'
  , '    sort:'
  , '      - property: priority'
  , '        direction: ASC'
  , '  - name: desc'
  , '    sort:'
  , '      - property: priority'
  , '        direction: DESC'
  , '  - name: legacy'
  , '    sort:'
  , '      - column: priority'
  , '        direction: DESC'
].join('\n') + '\n';

function makeApp(): App {
  return {
    vault: {
      adapter: { basePath: '/test/vault' },
      getMarkdownFiles: () => [...FILES.values()].filter(f => f.extension === 'md'),
      getAbstractFileByPath: (p: string) => FILES.get(p) ?? null,
      read: async (f: TFile) => (f.path === 'dash.base' ? BASE_YAML : `# ${f.basename}\n`),
    },
    metadataCache: {
      getFileCache: (f: TFile) => ({ frontmatter: FRONTMATTER[f.path] }),
      trigger: () => undefined,
      resolvedLinks: {},
    },
  } as unknown as App;
}

function names(result: { notes: Array<{ name: string }> }): string[] {
  return result.notes.map(n => n.name);
}

// A base whose view filters break in the two ways that matter: typo views
// call an unknown function or malformed syntax; the miss view references a
// property no note carries — a quiet, per-note exclusion, not an error.
// The first view stays clean so it is the safe default.
const BROKEN_YAML = [
  'views:'
  , '  - name: clean'
  , '  - name: typo'
  , '    filters: hasTg("project")'
  , '  - name: syntax'
  , '    filters: status =='
  , '  - name: miss'
  , '    filters: nosuchprop == "x"'
  , '  - name: escape'
  , "    filters: constructor.constructor(\"return 1\")()"
].join('\n') + '\n';

function makeBrokenApp(): App {
  const files = new Map(FILES);
  files.set('broken.base', makeFile('broken.base'));
  return {
    vault: {
      adapter: { basePath: '/test/vault' },
      getMarkdownFiles: () => [...files.values()].filter(f => f.extension === 'md'),
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
      read: async (f: TFile) => (f.path === 'broken.base' ? BROKEN_YAML : `# ${f.basename}\n`),
    },
    metadataCache: {
      getFileCache: (f: TFile) => ({ frontmatter: FRONTMATTER[f.path] }),
      trigger: () => undefined,
      resolvedLinks: {},
    },
  } as unknown as App;
}

describe('BasesAPI.queryBase with caller options', () => {
  const api = () => new BasesAPI(makeApp());

  it('an unknown function in a filter fails the query with the cause and the expression', async () => {
    const broken = new BasesAPI(makeBrokenApp());
    await expect(broken.queryBase('broken.base', 'typo'))
      .rejects.toThrow('Filter error: Unknown function "hasTg" — expression: hasTg("project")');
  });

  it('malformed filter syntax fails the query rather than matching nothing', async () => {
    const broken = new BasesAPI(makeBrokenApp());
    await expect(broken.queryBase('broken.base', 'syntax')).rejects.toThrow('Filter error:');
  });

  it('a blocked sandbox escape in a filter fails the query — still executed nothing', async () => {
    const broken = new BasesAPI(makeBrokenApp());
    await expect(broken.queryBase('broken.base', 'escape'))
      .rejects.toThrow('Filter error: Access to member "constructor"');
  });

  it('a filter on a property no note carries is a quiet miss, not an error', async () => {
    const broken = new BasesAPI(makeBrokenApp());
    // `miss` overrides the broken global filter with its own: nosuchprop
    // resolves to nothing on every note, evaluates false, excludes all.
    const result = await broken.queryBase('broken.base', 'miss');
    expect(names(result)).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns every note without options, in scan order when the view does not sort', async () => {
    // The default view is `plain`: order only, no sort. The result keeps
    // the vault scan order, proving `order:` no longer sorts the rows.
    const result = await api().queryBase('dash.base');
    expect(names(result)).toEqual(['beta', 'gamma', 'alpha']);
    expect(result.total).toBe(3);
  });

  it('honors the native view sort key, both directions', async () => {
    const asc = await api().queryBase('dash.base', 'main');
    expect(names(asc)).toEqual(['alpha', 'beta', 'gamma']);

    const desc = await api().queryBase('dash.base', 'desc');
    expect(names(desc)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('normalizes the legacy column: entry spelling of the view sort', async () => {
    const legacy = await api().queryBase('dash.base', 'legacy');
    expect(names(legacy)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('the caller sort refines the view sort and ties keep the view order', async () => {
    // View `main` sorts by priority ASC. The caller re-sorts by status DESC.
    // beta (archived) leads. alpha and gamma tie on status and keep the
    // view order: alpha before gamma.
    const result = await api().queryBase('dash.base', 'main', {
      sort: { property: 'status', order: 'desc' },
    });
    expect(names(result)).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('keeps only notes that pass every structured filter', async () => {
    const result = await api().queryBase('dash.base', undefined, {
      filters: [{ property: 'status', operator: 'equals', value: 'active' }],
    });
    expect(names(result).sort()).toEqual(['alpha', 'gamma'].sort());
  });

  it('compares strings case-insensitively by default, strictly when caseSensitive', async () => {
    const insensitive = await api().queryBase('dash.base', undefined, {
      filters: [{ property: 'status', operator: 'equals', value: 'ACTIVE' }],
    });
    expect(names(insensitive).sort()).toEqual(['alpha', 'gamma'].sort());

    const strict = await api().queryBase('dash.base', undefined, {
      filters: [{ property: 'status', operator: 'equals', value: 'ACTIVE', caseSensitive: true }],
    });
    expect(names(strict)).toEqual([]);
  });

  it('supports gt, contains, and is_empty operators', async () => {
    const gt = await api().queryBase('dash.base', undefined, {
      filters: [{ property: 'priority', operator: 'gt', value: 1 }],
    });
    expect(names(gt).sort()).toEqual(['beta', 'gamma'].sort());

    const contains = await api().queryBase('dash.base', undefined, {
      filters: [{ property: 'status', operator: 'contains', value: 'arch' }],
    });
    expect(names(contains)).toEqual(['beta']);

    const empty = await api().queryBase('dash.base', undefined, {
      filters: [{ property: 'missing', operator: 'is_empty', value: '' }],
    });
    expect(names(empty).sort()).toEqual(['alpha', 'beta', 'gamma'].sort());
  });

  it('sorts by one property in either direction', async () => {
    const asc = await api().queryBase('dash.base', undefined, {
      sort: { property: 'priority', order: 'asc' },
    });
    expect(names(asc)).toEqual(['alpha', 'beta', 'gamma']);

    const desc = await api().queryBase('dash.base', undefined, {
      sort: { property: 'priority', order: 'desc' },
    });
    expect(names(desc)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('pages the final list and keeps the pre-page total', async () => {
    const page1 = await api().queryBase('dash.base', undefined, {
      sort: { property: 'priority', order: 'asc' },
      pagination: { page: 1, pageSize: 2 },
    });
    expect(names(page1)).toEqual(['alpha', 'beta']);
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(2);

    const page2 = await api().queryBase('dash.base', undefined, {
      sort: { property: 'priority', order: 'asc' },
      pagination: { page: 2, pageSize: 2 },
    });
    expect(names(page2)).toEqual(['gamma']);
  });

  it('projects notes down to the named properties', async () => {
    const result = await api().queryBase('dash.base', undefined, {
      properties: ['status'],
    });
    for (const note of result.notes) {
      expect(Object.keys(note.properties)).toEqual(['status']);
    }
  });

  it('applies the same options to export serialization', async () => {
    const csv = await api().exportBase('dash.base', 'csv', 'main', {
      filters: [{ property: 'status', operator: 'equals', value: 'active' }],
    });
    // Columns come from the view order key: status and priority only. The
    // two active notes (alpha priority 1, gamma priority 3) survive the
    // filter; beta (archived) does not.
    expect(csv.split('\n')[0]).toBe('status,priority');
    expect(csv).toContain('active,1');
    expect(csv).toContain('active,3');
    expect(csv).not.toContain('archived');
  });

  it('falls back to all properties when the view has no column order', async () => {
    // The `desc` view sets no order key, so every property becomes a column.
    const csv = await api().exportBase('dash.base', 'csv', 'desc');
    const header = csv.split('\n')[0];
    expect(header).toContain('status');
    expect(header).toContain('file.name');
  });
});

describe('bases.query router wiring — flat params and format routing', () => {
  class RecordingAPI extends ObsidianAPI {
    queryCall: unknown[] | undefined;
    exportCall: unknown[] | undefined;

    constructor() {
      super({} as App);
    }

    async queryBase(...args: unknown[]): Promise<any> {
      this.queryCall = args;
      return { notes: [], total: 0 };
    }

    async exportBase(...args: unknown[]): Promise<any> {
      this.exportCall = args;
      return 'a,b';
    }
  }

  it('maps sortBy/sortOrder/page/pageSize onto the options object', async () => {
    const api = new RecordingAPI();
    await new VaultRouter(api).route({
      operation: 'bases',
      action: 'query',
      params: {
        path: 'dash.base'
        , filters: [{ property: 'status', operator: 'equals', value: 'active' }]
        , sortBy: 'priority'
        , sortOrder: 'desc'
        , page: 2
        , pageSize: 5
        , properties: ['status'],
      },
    });
    expect(api.queryCall).toEqual([
      'dash.base',
      undefined,
      {
        filters: [{ property: 'status', operator: 'equals', value: 'active' }]
        , sort: { property: 'priority', order: 'desc' }
        , pagination: { page: 2, pageSize: 5 }
        , properties: ['status'],
      },
    ]);
    expect(api.exportCall).toBeUndefined();
  });

  it('routes format to the serialized export path with the same options', async () => {
    const api = new RecordingAPI();
    const response: any = await new VaultRouter(api).route({
      operation: 'bases',
      action: 'query',
      params: { path: 'dash.base', format: 'csv', sortBy: 'priority' },
    });
    expect(api.exportCall).toEqual(['dash.base', 'csv', undefined, { sort: { property: 'priority', order: 'asc' } }]);
    expect(response.result).toMatchObject({ success: true, format: 'csv' });
  });

  it('sends no options object when no option param is given', async () => {
    const api = new RecordingAPI();
    await new VaultRouter(api).route({
      operation: 'bases',
      action: 'query',
      params: { path: 'dash.base', viewName: 'main' },
    });
    expect(api.queryCall).toEqual(['dash.base', 'main', undefined]);
  });
});

describe('bases.query pagination guards — invalid values fail closed', () => {
  class GuardAPI extends ObsidianAPI {
    queryCalls = 0;

    constructor() {
      super({} as App);
    }

    async queryBase(): Promise<any> {
      this.queryCalls++;
      return { notes: [], total: 0 };
    }
  }

  it('page=0 rejects before queryBase runs', async () => {
    const api = new GuardAPI();
    const response: any = await new VaultRouter(api).route({
      operation: 'bases',
      action: 'query',
      params: { path: 'dash.base', page: 0 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("bases.query: 'page' must be a whole number of at least 1");
    expect(api.queryCalls).toBe(0);
  });

  it('pageSize=0 rejects before queryBase runs', async () => {
    const api = new GuardAPI();
    const response: any = await new VaultRouter(api).route({
      operation: 'bases',
      action: 'query',
      params: { path: 'dash.base', pageSize: 0 },
    });
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("bases.query: 'pageSize' must be a whole number of at least 1");
    expect(api.queryCalls).toBe(0);
  });

  it('a non-integer page rejects', async () => {
    const api = new GuardAPI();
    const response: any = await new VaultRouter(api).route({
      operation: 'bases',
      action: 'query',
      params: { path: 'dash.base', page: 1.5 },
    });
    expect(response.error).toBeDefined();
    expect(api.queryCalls).toBe(0);
  });
});
