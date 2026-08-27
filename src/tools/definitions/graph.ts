/**
 * The graph tool: link and tag traversal across the vault. Registers itself
 * into the tool registry at import time.
 */
import { registerOperation } from '../tool-registry';
import { executeGraphOperation } from '../operations/graph';

registerOperation({
  name: 'graph'
  , title: 'Graph Navigation'
  , descriptionLines: [
    'Read the links between notes.'
    , ''
    , '- Search ranks by term frequency. Two notes on one topic in different words stay in separate result sets. A link between them usually exists.'
    , '- Traversal follows links, so it reaches the linked web of the vault. A relevant note without links sits outside that web. Search finds those notes.'
    , '- Scan broadly with `view.search` to catch the unlinked notes. Then follow links from the hits to catch the differently worded notes.'
    , ''
    , '## Actions'
    , { when: 'graph.neighbors', text: '- `neighbors` — The immediate links of a note.' }
    , { when: 'graph.traverse', text: '- `traverse` — Multi-hop exploration.' }
    , { when: 'graph.search-traverse', text: '- `search-traverse` — Scan and follow in one call.' }
    , { when: 'graph.advanced-traverse', text: '- `advanced-traverse` — Multi-query traversal with strategy control.' }
    , { when: 'graph.path', text: '- `path` — Find how two notes connect.' }
    , { when: 'graph.backlinks', text: '- `backlinks` — The links that point to a note.' }
    , { when: 'graph.forwardlinks', text: '- `forwardlinks` — The links a note points to.' }
    , { when: 'graph.statistics', text: '- `statistics` — Link counts. Without `sourcePath`: vault totals (notes, links, orphans, connected components). With `sourcePath`: the in and out link counts of one note.' }
    , { when: 'graph.tag-traverse', text: '- `tag-traverse` — Traverse through shared tags.' }
    , { when: 'graph.tag-analysis', text: '- `tag-analysis` — The tag structure of a note.' }
    , { when: 'graph.shared-tags', text: '- `shared-tags` — The tags two notes share.' }
  ]
  , actions: ['traverse', 'neighbors', 'path', 'statistics', 'backlinks', 'forwardlinks', 'search-traverse', 'advanced-traverse', 'tag-traverse', 'tag-analysis', 'shared-tags']
  , requiredParams: {
    traverse: ['sourcePath']
    , neighbors: ['sourcePath']
    , path: ['sourcePath', 'targetPath']
    , backlinks: ['sourcePath']
    , forwardlinks: ['sourcePath']
    , 'search-traverse': ['searchQuery']
    , 'advanced-traverse': ['searchQueries']
    , 'tag-traverse': ['startPath', 'searchQuery']
    , 'tag-analysis': ['startPath']
    , 'shared-tags': ['startPath', 'targetPath']
    // statistics takes nothing: no sourcePath means vault-wide.
  }
  , annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  }
  , execute: executeGraphOperation
  , parameters: {
    sourcePath: {
      type: 'string'
      , description: 'The starting file path for the link operations (traverse, neighbors, path, backlinks, forwardlinks, statistics)'
    }
    , targetPath: {
      type: 'string'
      , description: 'The target file path (for path finding operations)'
    }
    , maxDepth: {
      type: 'number'
      , description: 'The maximum depth for traversal (traverse)'
      , default: 3
    }
    , maxNodes: {
      type: 'number'
      , description: 'The maximum number of nodes to return (traverse)'
      , default: 100
    }
    , includeUnresolved: {
      type: 'boolean'
      , description: 'Include unresolved links in the results (forwardlinks)'
      , default: false
    }
    , followBacklinks: {
      type: 'boolean'
      , description: 'Follow backlinks during traversal (traverse)'
      , default: true
    }
    , followForwardLinks: {
      type: 'boolean'
      , description: 'Follow forward links during traversal (traverse)'
      , default: true
    }
    , followTags: {
      type: 'boolean'
      , description: 'Follow the tag connections during traversal (traverse)'
      , default: false
    }
    , fileFilter: {
      type: 'string'
      , description: 'The regex pattern tested against the vault-relative path (traverse, neighbors, backlinks, forwardlinks. Plain JavaScript syntax, case-sensitive)'
    }
    , tagFilter: {
      type: 'array'
      , items: { type: 'string' }
      , description: 'Only include files that carry every one of these tags (traverse, neighbors, backlinks, forwardlinks). A leading # is optional, and matching ignores case'
    }
    , folderFilter: {
      type: 'string'
      , description: 'Only include files in this folder and its subfolders (traverse, neighbors, backlinks, forwardlinks)'
    }
    // Graph search traversal parameters
    , startPath: {
      type: 'string'
      , description: 'The starting file path for the tag operations (tag-traverse, tag-analysis, shared-tags) and an optional start for search-traverse'
    }
    , searchQuery: {
      type: 'string'
      , description: 'The search query to apply at each node (for search-traverse and tag-traverse). Plain words, split on whitespace. Matching is case-insensitive'
    }
    , searchQueries: {
      type: 'array'
      , items: { type: 'string' }
      , description: 'The search queries (for advanced-traverse)'
    }
    , maxSnippetsPerNode: {
      type: 'number'
      , description: 'The maximum number of snippets to extract per node (search-traverse, advanced-traverse, tag-traverse)'
      , default: 2
    }
    , scoreThreshold: {
      type: 'number'
      , description: 'The minimum score threshold for including nodes (0-1, search-traverse, advanced-traverse, tag-traverse)'
      , default: 0.5
    }
    // Unwired (verified 2026-08-23): strategy is only echoed into a response
    // label and beamWidth feeds options that ignore it. See the vault TODO
    // before you touch these descriptions.
    , strategy: {
      type: 'string'
      , enum: ['breadth-first', 'best-first', 'beam-search']
      , description: 'The traversal strategy (for advanced-traverse)'
    }
    , beamWidth: {
      type: 'number'
      , description: 'The beam width for the beam-search strategy (advanced-traverse)'
    }
    , includeOrphans: {
      type: 'boolean'
      , description: 'Include orphaned notes in the traversal (search-traverse, advanced-traverse, tag-traverse)'
      , default: false
    }
    , filePattern: {
      type: 'string'
      , description: 'Only traverse files whose vault-relative path matches this regex: non-matching notes are never visited or expanded (search-traverse, advanced-traverse, tag-traverse. Plain JavaScript syntax, case-sensitive)'
    }
    // Tag-based graph parameters
    , tagWeight: {
      type: 'number'
      , description: 'The weight factor for tag connections (tag-traverse. 0-1)'
      , default: 0.8
    }
  }
});
