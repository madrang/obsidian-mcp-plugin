/**
 * graph traverse. Breadth-first walk from a starting point; the path and
 * tag filters compose into the walk itself, so it never enters a filtered
 * note.
 */
import { App } from 'obsidian';
import { GraphTraversal, GraphTraversalOptions } from '../../utils/graph-traversal';
import { GraphSearchParams, GraphSearchResult } from './types';
import { buildPathFilters, buildTagPredicate, nodeTags } from './filters';

/**
 * Perform graph traversal from a starting point
 */
export function performTraversal(traversal: GraphTraversal, app: App, params: GraphSearchParams): GraphSearchResult {
  if (!params.sourcePath && params.sourcePath !== '') {
    throw new Error('Source path is required for traversal operation');
  }

  const options: GraphTraversalOptions = {
    maxDepth: params.maxDepth || 3
    , maxNodes: params.maxNodes || 50
    , includeUnresolved: params.includeUnresolved || false
    , followBacklinks: params.followBacklinks !== false
    , followForwardLinks: params.followForwardLinks !== false
    , followTags: params.followTags || false
  };

  // Filters compose: a note enters the walk only when every filter passes.
  const nodeFilters = buildPathFilters(params);
  const tagPredicate = buildTagPredicate(params.tagFilter);
  if (nodeFilters.length > 0 || tagPredicate) {
    options.nodeFilter = node =>
      nodeFilters.every(filter => filter(node.path))
      && (!tagPredicate || tagPredicate(nodeTags(node.metadata)));
  }

  const result = traversal.breadthFirstTraversal(params.sourcePath, options);

  // Convert to response format
  const nodes = Array.from(result.nodes.values()).map(node => ({
    path: node.path
    , title: node.title
    , type: 'file' as const
    , tags: nodeTags(node.metadata)
    , links: {
      forward: traversal.getForwardLinks(node.path).length
      , backward: traversal.getBacklinks(node.path).length
      , total: traversal.getForwardLinks(node.path).length +
             traversal.getBacklinks(node.path).length
    }
  }));

  const response: GraphSearchResult = {
    operation: 'traverse'
    , sourcePath: params.sourcePath
    , nodes
    , edges: result.edges
    , graphStats: result.stats
    , message: params.sourcePath === '/' || params.sourcePath === ''
      ? `Traversed from ${Math.min(10, app.vault.getFiles().filter(f => !traversal.isExcluded(f.path)).length)} most recent files: Found ${result.stats.totalNodes} connected nodes within ${params.maxDepth} degrees`
      : `Found ${result.stats.totalNodes} connected nodes within ${params.maxDepth} degrees of separation`
    , workflow: {
      message: 'Graph traversal complete. You can explore individual nodes or find paths between them.'
      , suggested_next: [
        {
          description: 'View a specific file'
          , command: 'view:file'
          , reason: 'To see the content of any discovered node'
        }
        , {
          description: 'Get statistics for a node'
          , command: 'graph:statistics'
          , reason: 'To see detailed link statistics for a file'
        }
        , {
          description: 'Find path between nodes'
          , command: 'graph:path'
          , reason: 'To find connections between two specific files'
        }
      ]
    }
  };

  return response;
}
