/**
 * graph listing operations: neighbors, backlinks, forwardlinks. They share
 * the node-mapping loop and the listing filters that narrow the results to
 * the caller's path and tag filters.
 */
import { App, TFile } from 'obsidian';
import { GraphTraversal } from '../../utils/graph-traversal';
import { GraphSearchParams, GraphSearchResult } from './types';
import { buildPathFilters, buildTagPredicate, nodeTags } from './filters';

/**
 * Filter the nodes and edges of a listing result. A node survives the path
 * filters and the tag filter. An edge survives only when both endpoints
 * survive. The source note itself is filtered like any other node.
 */
export function applyListingFilters(params: GraphSearchParams, result: GraphSearchResult): GraphSearchResult {
  const pathFilters = buildPathFilters(params);
  const tagPredicate = buildTagPredicate(params.tagFilter);
  if ((pathFilters.length === 0 && !tagPredicate) || !result.nodes) return result;

  const keepNode = (node: { path: string; tags?: string[] }) =>
    pathFilters.every(filter => filter(node.path))
    && (!tagPredicate || tagPredicate(node.tags));

  const nodes = result.nodes.filter(keepNode);
  const keptPaths = new Set(nodes.map(node => node.path));
  const edges = (result.edges ?? []).filter(edge => keptPaths.has(edge.source) && keptPaths.has(edge.target));
  // The handler's message counts the pre-filter set ("Found 9 direct
  // neighbors"), which now disagrees with the lists below it. Restate it
  // against the kept set.
  return {
    ...result
    , nodes
    , edges
    , message: `Filters kept ${nodes.length} of ${result.nodes.length} notes`
  };
}

/**
 * Get immediate neighbors of a node
 */
export function getNeighbors(traversal: GraphTraversal, params: GraphSearchParams): GraphSearchResult {
  if (!params.sourcePath) {
    throw new Error('Source path is required for neighbors operation');
  }

  const { node, neighbors, edges } = traversal.getLocalNeighborhood(params.sourcePath);

  const nodes = [node, ...neighbors].map(n => ({
    path: n.path
    , title: n.title
    , type: 'file' as const
    , tags: nodeTags(n.metadata)
    , links: {
      forward: traversal.getForwardLinks(n.path).length
      , backward: traversal.getBacklinks(n.path).length
      , total: traversal.getForwardLinks(n.path).length +
             traversal.getBacklinks(n.path).length
    }
  }));

  return {
    operation: 'neighbors'
    , sourcePath: params.sourcePath
    , nodes
    , edges
    , message: `Found ${neighbors.length} direct neighbors of ${node.title}`
    , workflow: {
      message: 'Local neighborhood retrieved. You can explore connections or expand the search.'
      , suggested_next: [
        {
          description: 'Traverse deeper from this node'
          , command: 'graph:traverse'
          , reason: 'To explore connections beyond immediate neighbors'
        }
        , {
          description: 'View file content'
          , command: 'view:file'
          , reason: 'To examine the content of connected files'
        }
      ]
    }
  };
}

/**
 * Get backlinks (incoming links) for a file
 */
export function getBacklinks(traversal: GraphTraversal, app: App, params: GraphSearchParams): GraphSearchResult {
  if (!params.sourcePath) {
    throw new Error('Source path is required for backlinks operation');
  }

  const backlinks = traversal.getBacklinks(params.sourcePath);
  const nodes: GraphSearchResult['nodes'] = [];

  // Get node information for each backlink source
  for (const edge of backlinks) {
    const file = app.vault.getAbstractFileByPath(edge.source);
    if (file && file instanceof TFile) {
      const cache = app.metadataCache.getFileCache(file);
      nodes.push({
        path: edge.source
        , title: traversal.getNodeTitle(file)
        , type: 'file'
        , tags: nodeTags(cache)
        , links: {
          forward: traversal.getForwardLinks(edge.source).length
          , backward: traversal.getBacklinks(edge.source).length
          , total: 0 // Will be calculated
        }
      });
      nodes[nodes.length - 1].links!.total =
        nodes[nodes.length - 1].links!.forward + nodes[nodes.length - 1].links!.backward;
    }
  }

  return {
    operation: 'backlinks'
    , sourcePath: params.sourcePath
    , nodes
    , edges: backlinks
    , message: `Found ${backlinks.length} files linking to this file`
    , workflow: {
      message: 'Backlinks retrieved. You can explore these files or analyze their connections.'
      , suggested_next: [
        {
          description: 'View a linking file'
          , command: 'view:file'
          , reason: 'To see how these files reference the source'
        }
        , {
          description: 'Traverse from a backlink'
          , command: 'graph:traverse'
          , reason: 'To explore the network around files that link here'
        }
      ]
    }
  };
}

/**
 * Get forward links (outgoing links) from a file
 */
export function getForwardLinks(traversal: GraphTraversal, app: App, params: GraphSearchParams): GraphSearchResult {
  if (!params.sourcePath) {
    throw new Error('Source path is required for forward links operation');
  }

  const forwardLinks = traversal.getForwardLinks(params.sourcePath);
  const unresolvedLinks = params.includeUnresolved
    ? traversal.getUnresolvedForwardLinks(params.sourcePath)
    : [];
  const allForwardLinks = [...forwardLinks, ...unresolvedLinks];
  const nodes: GraphSearchResult['nodes'] = [];

  // Get node information for each forward link target
  for (const edge of allForwardLinks) {
    const file = app.vault.getAbstractFileByPath(edge.target);
    if (file && file instanceof TFile) {
      const cache = app.metadataCache.getFileCache(file);
      nodes.push({
        path: edge.target
        , title: traversal.getNodeTitle(file)
        , type: 'file'
        , tags: nodeTags(cache)
        , links: {
          forward: traversal.getForwardLinks(edge.target).length
          , backward: traversal.getBacklinks(edge.target).length
          , total: 0
        }
      });
      nodes[nodes.length - 1].links!.total =
        nodes[nodes.length - 1].links!.forward + nodes[nodes.length - 1].links!.backward;
    }
  }

  return {
    operation: 'forwardlinks'
    , sourcePath: params.sourcePath
    , nodes
    , edges: allForwardLinks
    , message: `Found ${allForwardLinks.length} files linked from this file`
    , workflow: {
      message: 'Forward links retrieved. You can explore these referenced files.'
      , suggested_next: [
        {
          description: 'View a linked file'
          , command: 'view:file'
          , reason: 'To see the content of referenced files'
        }
        , {
          description: 'Find path to a linked file'
          , command: 'graph:path'
          , reason: 'To explore alternative connections between files'
        }
      ]
    }
  };
}
