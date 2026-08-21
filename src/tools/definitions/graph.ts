/**
 * The graph tool: link and tag traversal across the vault. Registers itself
 * into the tool registry at import time.
 */
import { registerOperation } from '../tool-registry';
import { executeGraphOperation } from '../../semantic/operations/graph';

registerOperation({
  name: 'graph',
  title: 'Graph Navigation',
  descriptionLines: [
    '🕸️ Graph navigation. Follow the links the vault already has.',
    '',
    '## When to use this tool',
    '- Use this tool to expand from a note you already found. Do not run another search first.',
    '- Search ranks by term frequency. It cannot reach a note that covers the topic in different words. A link to that note usually exists.',
    '- Traversal has a mirror blind spot. It only reaches notes that someone actually linked. A note can be relevant and still be unlinked. No traversal finds it.',
    '- The two tools are complements. Scan broadly with `view.search` to catch the unlinked notes. Then follow links from the hits to catch the differently worded notes. Trust neither tool alone.',
    '',
    '## Actions',
    { when: 'graph.neighbors', text: '- `neighbors` — the immediate links of a note. Start here.' },
    { when: 'graph.traverse', text: '- `traverse` — multi-hop exploration.' },
    { when: 'graph.search-traverse', text: '- `search-traverse` — scan and follow in one call. It returns snippets per node and prunes on `scoreThreshold`. Use it to discover which notes matter. Then read those notes. Do not treat its snippets as the whole argument.' },
    { when: 'graph.advanced-traverse', text: '- `advanced-traverse` — multi-query traversal with strategy control.' },
    { when: 'graph.path', text: '- `path` — find how two notes connect.' },
    { when: 'graph.backlinks', text: '- `backlinks` — the links that point to a note. Backlinks show what depends on it. The text of the note itself does not know.' },
    { when: 'graph.forwardlinks', text: '- `forwardlinks` — the links a note points to.' },
    { when: 'graph.statistics', text: '- `statistics` — link counts. Call it without `sourcePath` for vault-wide density.' },
    { when: 'graph.tag-traverse', text: '- `tag-traverse` — traverse through shared tags.' },
    { when: 'graph.tag-analysis', text: '- `tag-analysis` — the tag structure of a note.' },
    { when: 'graph.shared-tags', text: '- `shared-tags` — the tags two notes share.' }
  ],
  actions: ['traverse', 'neighbors', 'path', 'statistics', 'backlinks', 'forwardlinks', 'search-traverse', 'advanced-traverse', 'tag-traverse', 'tag-analysis', 'shared-tags'],
  requiredParams: {
    traverse: ['sourcePath'],
    neighbors: ['sourcePath'],
    path: ['sourcePath', 'targetPath'],
    backlinks: ['sourcePath'],
    forwardlinks: ['sourcePath'],
    'search-traverse': ['searchQuery'],
    'advanced-traverse': ['searchQueries'],
    'tag-traverse': ['startPath', 'searchQuery'],
    'tag-analysis': ['startPath'],
    'shared-tags': ['startPath', 'targetPath']
    // statistics takes nothing: no sourcePath means vault-wide.
  },
  annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  },
  execute: executeGraphOperation,
  parameters: {
    sourcePath: {
      type: 'string',
      description: 'The starting file path for graph operations'
    },
    targetPath: {
      type: 'string',
      description: 'The target file path (for path finding operations)'
    },
    maxDepth: {
      type: 'number',
      description: 'The maximum depth for traversal (default: 3)'
    },
    maxNodes: {
      type: 'number',
      description: 'The maximum number of nodes to return (default: 50)'
    },
    includeUnresolved: {
      type: 'boolean',
      description: 'Include unresolved links in the results'
    },
    followBacklinks: {
      type: 'boolean',
      description: 'Follow backlinks during traversal (default: true)'
    },
    followForwardLinks: {
      type: 'boolean',
      description: 'Follow forward links during traversal (default: true)'
    },
    followTags: {
      type: 'boolean',
      description: 'Follow the tag connections during traversal'
    },
    fileFilter: {
      type: 'string',
      description: 'The regex pattern to filter file names'
    },
    tagFilter: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only include files with these tags'
    },
    folderFilter: {
      type: 'string',
      description: 'Only include files in this folder'
    },
    // Graph search traversal parameters
    startPath: {
      type: 'string',
      description: 'The starting file path for search traversal'
    },
    searchQuery: {
      type: 'string',
      description: 'The search query to apply at each node (for search-traverse)'
    },
    searchQueries: {
      type: 'array',
      items: { type: 'string' },
      description: 'The search queries (for advanced-traverse)'
    },
    maxSnippetsPerNode: {
      type: 'number',
      description: 'The maximum number of snippets to extract per node (default: 2)'
    },
    scoreThreshold: {
      type: 'number',
      description: 'The minimum score threshold for including nodes (0-1, default: 0.5)'
    },
    strategy: {
      type: 'string',
      enum: ['breadth-first', 'best-first', 'beam-search'],
      description: 'The traversal strategy (for advanced-traverse)'
    },
    beamWidth: {
      type: 'number',
      description: 'The beam width for the beam-search strategy'
    },
    includeOrphans: {
      type: 'boolean',
      description: 'Include orphaned notes in the traversal'
    },
    filePattern: {
      type: 'string',
      description: 'Filter the traversal to files that match this pattern'
    },
    // Tag-based graph parameters
    tagWeight: {
      type: 'number',
      description: 'The weight factor for tag connections (0-1, default: 0.8)'
    }
  }
});
