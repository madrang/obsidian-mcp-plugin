import { App, TFile } from 'obsidian';
import { GraphSearchTool } from '../src/tools/graph/search';
import { formatGraphResponse } from '../src/tools/graph/format';
import { ObsidianAPI } from '../src/utils/obsidian-api';

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  // getNodeTitle (added in #207, merged before this PR landed) reads
  // basename — make the mock match the real TFile API.
  file.basename = file.name.replace(/\.md$/, '');
  file.extension = 'md';
  return file;
}

describe('GraphSearchTool', () => {
  let app: App;
  let tool: GraphSearchTool;

  beforeEach(() => {
    const resolvedTarget = makeFile('resolved.md');

    app = new App();
    (app as any).metadataCache = {
      resolvedLinks: {
        'source.md': { 'resolved.md': 1 }
      },
      unresolvedLinks: {
        'source.md': { 'Missing Note': 1 }
      },
      getFileCache: jest.fn().mockReturnValue({ tags: [] })
    };
    app.vault.getAbstractFileByPath = jest.fn((path: string) =>
      path === 'resolved.md' ? resolvedTarget : null
    );

    tool = new GraphSearchTool({ getIgnoreManager: () => undefined } as unknown as ObsidianAPI, app);
  });

  it('omits unresolved forward links by default', () => {
    const result = tool.search({
      operation: 'forwardlinks',
      sourcePath: 'source.md'
    });

    expect(result.edges).toEqual([
      { source: 'source.md', target: 'resolved.md', type: 'link', count: 1 }
    ]);
    expect(result.nodes).toEqual([
      expect.objectContaining({ path: 'resolved.md', title: 'resolved' })
    ]);
  });

  it('includes unresolved forward links when requested', () => {
    const result = tool.search({
      operation: 'forwardlinks',
      sourcePath: 'source.md',
      includeUnresolved: true
    });

    expect(result.edges).toEqual([
      { source: 'source.md', target: 'resolved.md', type: 'link', count: 1 },
      { source: 'source.md', target: 'Missing Note', type: 'link', count: 1 }
    ]);
    expect(result.nodes).toEqual([
      expect.objectContaining({ path: 'resolved.md', title: 'resolved' })
    ]);
    expect(result.message).toBe('Found 2 files linked from this file');
  });
});

describe('GraphSearchTool traverse depth', () => {
  // Chain a.md -> b.md -> c.md: one hop per depth level.
  function chainTool(): GraphSearchTool {
    const files = ['a.md', 'b.md', 'c.md'];
    const app = new App();
    (app as any).metadataCache = {
      resolvedLinks: { 'a.md': { 'b.md': 1 }, 'b.md': { 'c.md': 1 } }
      , unresolvedLinks: {}
      , getFileCache: jest.fn().mockReturnValue({ tags: [] })
    };
    app.vault.getAbstractFileByPath = jest.fn((path: string) =>
      files.includes(path) ? makeFile(path) : null
    );
    return new GraphSearchTool({ getIgnoreManager: () => undefined } as unknown as ObsidianAPI, app);
  }

  it('carries per-node depth through the raw response', () => {
    const result = chainTool().search({ operation: 'traverse', sourcePath: 'a.md' });

    const depths = new Map((result.nodes ?? []).map(n => [n.path, n.depth]));
    expect(depths.get('a.md')).toBe(0);
    expect(depths.get('b.md')).toBe(1);
    expect(depths.get('c.md')).toBe(2);
  });

  it('renders one section per depth, in order', () => {
    const raw = chainTool().search({ operation: 'traverse', sourcePath: 'a.md' });
    const formatted = formatGraphResponse('traverse', raw) as string;

    const first = formatted.indexOf('## Depth 0');
    const second = formatted.indexOf('## Depth 1');
    const third = formatted.indexOf('## Depth 2');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(formatted).not.toContain('## Depth 3');
  });
});
