import { App, TFile } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { GraphSearchTool } from '../src/tools/graph/search';
import { buildPathFilters, buildTagPredicate } from '../src/tools/graph/filters';

// fileFilter and tagFilter wiring. traverse restricts the walk itself. The
// listing actions (neighbors, backlinks, forwardlinks) filter the returned
// nodes and edges. The filters compose instead of clobbering each other.
// path and statistics stay unfiltered: a found path breaks when its middle
// nodes disappear, and statistics counts globally.

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop()!;
  f.basename = f.name.replace(/\.[^.]+$/, '');
  f.extension = 'md';
  (f as unknown as { stat: unknown }).stat = { ctime: 0, mtime: 0, size: 10 };
  return f;
}

// Projects/a.md links to Projects/b.md, Projects/c.md, Other/d.md, and
// Projects/e.md. Tagged: a and b carry #core inline. d carries #core and
// #extra inline. c carries none. e carries #fm in FRONTMATTER only — the
// regression shape for the tagFilter bug: reading cache.tags alone sees
// inline #tags, and a vault that keeps tags in frontmatter failed every
// tag filter.
const FILES = new Map<string, TFile>([
  ['Projects/a.md', makeFile('Projects/a.md')],
  ['Projects/b.md', makeFile('Projects/b.md')],
  ['Projects/c.md', makeFile('Projects/c.md')],
  ['Other/d.md', makeFile('Other/d.md')],
  ['Projects/e.md', makeFile('Projects/e.md')],
]);

const TAGS: Record<string, string[]> = {
  'Projects/a.md': ['#core'],
  'Projects/b.md': ['#core'],
  'Projects/c.md': [],
  'Other/d.md': ['#core', '#extra'],
  'Projects/e.md': [],
};

const FRONTMATTER_TAGS: Record<string, string[]> = {
  'Projects/e.md': ['fm'],
};

const RESOLVED_LINKS: Record<string, Record<string, number>> = {
  'Projects/a.md': { 'Projects/b.md': 1, 'Projects/c.md': 1, 'Other/d.md': 1, 'Projects/e.md': 1 },
  'Projects/b.md': {},
  'Projects/c.md': {},
  'Other/d.md': {},
  'Projects/e.md': {},
};

function makeApp(): App {
  return {
    vault: {
      adapter: { basePath: '/test/vault' },
      getFiles: () => [...FILES.values()],
      getMarkdownFiles: () => [...FILES.values()],
      getAbstractFileByPath: (p: string) => FILES.get(p) ?? null,
      read: async () => '',
    },
    metadataCache: {
      resolvedLinks: RESOLVED_LINKS,
      unresolvedLinks: {},
      getFileCache: (f: TFile) => ({
        tags: (TAGS[f.path] ?? []).map(tag => ({ tag })),
        ...(f.path in FRONTMATTER_TAGS ? { frontmatter: { tags: FRONTMATTER_TAGS[f.path] } } : {}),
      }),
      trigger: () => undefined,
    },
  } as unknown as App;
}

function tool(): GraphSearchTool {
  return new GraphSearchTool(new ObsidianAPI(makeApp()), makeApp());
}

const paths = (result: { nodes?: Array<{ path: string }> }): string[] =>
  (result.nodes ?? []).map(n => n.path);

describe('buildPathFilters', () => {
  it('returns no filter when no filter param is given', () => {
    expect(buildPathFilters({})).toHaveLength(0);
    expect(buildPathFilters({ fileFilter: undefined, folderFilter: undefined })).toHaveLength(0);
  });

  it('tests the regex against the full vault-relative path', () => {
    const [filter] = buildPathFilters({ fileFilter: '^Projects/.*\\.md$' });
    expect(filter('Projects/a.md')).toBe(true);
    expect(filter('Other/d.md')).toBe(false);
  });

  it('matches a folder and its subfolders, not prefix siblings', () => {
    const [filter] = buildPathFilters({ folderFilter: 'Projects' });
    expect(filter('Projects/a.md')).toBe(true);
    expect(filter('Projects/sub/deep.md')).toBe(true);
    expect(filter('ProjectsX/a.md')).toBe(false);
    expect(filter('Projects')).toBe(true);
  });

  it('composes: every filter must pass', () => {
    const filters = buildPathFilters({ fileFilter: 'b\\.md$', folderFilter: 'Projects' });
    const passes = (p: string) => filters.every(f => f(p));
    expect(passes('Projects/b.md')).toBe(true);
    expect(passes('Projects/c.md')).toBe(false);
    expect(passes('Other/b.md')).toBe(false);
  });
});

describe('fileFilter on the listing actions', () => {
  it('neighbors without filters returns every neighbor', async () => {
    const result = tool().search({ operation: 'neighbors', sourcePath: 'Projects/a.md' });
    expect(paths(result).sort()).toEqual([
      'Other/d.md', 'Projects/a.md', 'Projects/b.md', 'Projects/c.md', 'Projects/e.md',
    ].sort());
    // No filters, so the handler's own count line stands.
    expect(result.message).toContain('Found 4 direct neighbors');
  });

  it('neighbors with a fileFilter drops non-matching nodes and their edges', () => {
    const result = tool().search({
      operation: 'neighbors'
      , sourcePath: 'Projects/a.md'
      , fileFilter: '^Projects/',
    });
    expect(paths(result).sort()).toEqual(['Projects/a.md', 'Projects/b.md', 'Projects/c.md', 'Projects/e.md'].sort());
    expect(result.edges?.every(e => e.target !== 'Other/d.md')).toBe(true);
    // The message restates the count against the kept set: the pre-filter
    // line ("Found 4 direct neighbors") no longer disagrees with the list.
    expect(result.message).toBe('Filters kept 4 of 5 notes');
  });

  it('neighbors with a folderFilter keeps only the subtree', () => {
    const result = tool().search({
      operation: 'neighbors'
      , sourcePath: 'Projects/a.md'
      , folderFilter: 'Other',
    });
    expect(paths(result)).toEqual(['Other/d.md']);
  });

  it('backlinks are filtered too', () => {
    // Other/d.md has one backlink: Projects/a.md.
    const kept = tool().search({
      operation: 'backlinks'
      , sourcePath: 'Other/d.md'
      , folderFilter: 'Projects',
    });
    expect(paths(kept)).toContain('Projects/a.md');

    const dropped = tool().search({
      operation: 'backlinks'
      , sourcePath: 'Other/d.md'
      , folderFilter: 'Other',
    });
    expect(paths(dropped)).not.toContain('Projects/a.md');
  });
});

describe('buildTagPredicate', () => {
  it('returns no predicate when no tag filter is given', () => {
    expect(buildTagPredicate(undefined)).toBeUndefined();
    expect(buildTagPredicate([])).toBeUndefined();
  });

  it('requires every listed tag, ignoring the # prefix and case', () => {
    const predicate = buildTagPredicate(['core', '#EXTRA'])!;
    expect(predicate(['#core', '#extra'])).toBe(true);
    expect(predicate(['#core'])).toBe(false);
    expect(predicate(undefined)).toBe(false);
    expect(predicate([])).toBe(false);
  });
});

describe('tagFilter on the listing actions', () => {
  it('tagFilter sees frontmatter tags, not only inline #tags', () => {
    // Nodes built from cache.tags alone see inline #tags only; a vault
    // keeping tags in frontmatter then fails every tag filter. getAllTags
    // merges both sources.
    const result = tool().search({
      operation: 'neighbors'
      , sourcePath: 'Projects/a.md'
      , tagFilter: ['fm'],
    });
    expect(paths(result)).toContain('Projects/e.md');
  });

  it('a node without inline tags reports its frontmatter tags', () => {
    const result = tool().search({ operation: 'neighbors', sourcePath: 'Projects/a.md' });
    const e = (result.nodes ?? []).find(n => n.path === 'Projects/e.md');
    expect(e?.tags).toEqual(['#fm']);
  });

  it('neighbors with a tagFilter keeps only tagged nodes and their edges', () => {
    const result = tool().search({
      operation: 'neighbors'
      , sourcePath: 'Projects/a.md'
      , tagFilter: ['core'],
    });
    // c.md carries no tags, so it drops out with its edge.
    expect(paths(result).sort()).toEqual(['Other/d.md', 'Projects/a.md', 'Projects/b.md'].sort());
    expect(result.edges?.every(e => e.target !== 'Projects/c.md')).toBe(true);
  });

  it('every listed tag must be present', () => {
    const result = tool().search({
      operation: 'neighbors'
      , sourcePath: 'Projects/a.md'
      , tagFilter: ['core', 'extra'],
    });
    expect(paths(result)).toEqual(['Other/d.md']);
  });

  it('composes with the path filters', () => {
    const result = tool().search({
      operation: 'neighbors'
      , sourcePath: 'Projects/a.md'
      , tagFilter: ['core']
      , folderFilter: 'Projects',
    });
    expect(paths(result).sort()).toEqual(['Projects/a.md', 'Projects/b.md'].sort());
  });
});

describe('tagFilter on traverse', () => {
  it('restricts the walk to tagged notes', () => {
    const result = tool().search({
      operation: 'traverse'
      , sourcePath: 'Projects/a.md'
      , tagFilter: ['core']
      , maxDepth: 2,
    });
    // c.md carries no tags, so the walk never enters it.
    expect(paths(result).sort()).toEqual(['Other/d.md', 'Projects/a.md', 'Projects/b.md'].sort());
  });

  it('gates the root too: a non-matching start yields nothing', () => {
    const result = tool().search({
      operation: 'traverse'
      , sourcePath: 'Projects/a.md'
      , tagFilter: ['extra']
      , maxDepth: 2,
    });
    expect(paths(result)).toEqual([]);
  });
});

describe('fileFilter on traverse', () => {
  it('restricts the walk to matching notes', () => {
    const result = tool().search({
      operation: 'traverse'
      , sourcePath: 'Projects/a.md'
      , fileFilter: '^Projects/'
      , maxDepth: 2,
    });
    expect(paths(result)).not.toContain('Other/d.md');
  });

  it('composes folderFilter and tagFilter: each drops a different node', () => {
    // d.md fails folderFilter (Other/). c.md fails tagFilter (no tags).
    // Only a.md and b.md pass both.
    const result = tool().search({
      operation: 'traverse'
      , sourcePath: 'Projects/a.md'
      , folderFilter: 'Projects'
      , tagFilter: ['core']
      , maxDepth: 2,
    });
    expect(paths(result).sort()).toEqual(['Projects/a.md', 'Projects/b.md'].sort());
  });
});
