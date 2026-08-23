import { App, TFile } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { GraphSearchTool, buildPathFilters, buildTagPredicate } from '../src/tools/graph-search';

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

// Projects/a.md links to Projects/b.md, Projects/c.md, and Other/d.md.
// Tagged: a and b carry #core. d carries #core and #extra. c carries none.
const FILES = new Map<string, TFile>([
  ['Projects/a.md', makeFile('Projects/a.md')],
  ['Projects/b.md', makeFile('Projects/b.md')],
  ['Projects/c.md', makeFile('Projects/c.md')],
  ['Other/d.md', makeFile('Other/d.md')],
]);

const TAGS: Record<string, string[]> = {
  'Projects/a.md': ['#core'],
  'Projects/b.md': ['#core'],
  'Projects/c.md': [],
  'Other/d.md': ['#core', '#extra'],
};

const RESOLVED_LINKS: Record<string, Record<string, number>> = {
  'Projects/a.md': { 'Projects/b.md': 1, 'Projects/c.md': 1, 'Other/d.md': 1 },
  'Projects/b.md': {},
  'Projects/c.md': {},
  'Other/d.md': {},
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
      getFileCache: (f: TFile) => ({ tags: (TAGS[f.path] ?? []).map(tag => ({ tag })) }),
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
      'Other/d.md', 'Projects/a.md', 'Projects/b.md', 'Projects/c.md',
    ].sort());
  });

  it('neighbors with a fileFilter drops non-matching nodes and their edges', () => {
    const result = tool().search({
      operation: 'neighbors'
      , sourcePath: 'Projects/a.md'
      , fileFilter: '^Projects/',
    });
    expect(paths(result).sort()).toEqual(['Projects/a.md', 'Projects/b.md', 'Projects/c.md'].sort());
    expect(result.edges?.every(e => e.target !== 'Other/d.md')).toBe(true);
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
