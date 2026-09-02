/**
 * Normalize a router response onto the shape the formatter expects. Each
 * case maps one action.
 */
export function normalizeGraphResponse(action: string, response: unknown): unknown {
  const resp = (typeof response === 'object' && response !== null ? response : {}) as Record<string, unknown>;

  switch (action) {
    // traverse: router returns {nodes: [{path,title,type,links}], edges, graphStats, message}
    // formatter expects {sourcePath, maxDepth, nodes: [{path,title,depth}], totalNodes}
    case 'traverse': {
      const traverseNodes = resp.nodes as Array<Record<string, unknown>> | undefined;
      const graphStats = resp.graphStats as Record<string, unknown> | undefined;
      const edges = (resp.edges as Array<Record<string, unknown>>) || [];
      if (traverseNodes && Array.isArray(traverseNodes)) {
        return {
          sourcePath: resp.sourcePath ?? resp.message ?? ''
          , maxDepth: graphStats?.maxDepthReached ?? 3
          , totalNodes: graphStats?.totalNodes ?? traverseNodes.length
          , nodes: traverseNodes.map(n => {
            const outgoing = edges
              .filter(e => e.source === n.path)
              .map(e => (e.target as string).split('/').pop() || e.target);
            return {
              path: n.path
              , title: n.title
              , depth: 0 // depth per node not tracked in this response shape
              , links: outgoing.length > 0 ? outgoing : undefined
              , tags: n.tags
            };
          })
          , edges: resp.edges
          , graphStats
        };
      }
      return resp;
    }

    // advanced-traverse: same shape as search-traverse but snippetChain is
    // embedded inside details.traversalChain instead of top-level snippetChain
    case 'advanced-traverse':
    case 'tag-traverse': {
      // If snippetChain already exists, pass through (tag-traverse has it)
      if (resp.snippetChain) return resp;

      // For advanced-traverse, build snippetChain from details.traversalChain
      const details = resp.details as Record<string, unknown> | undefined;
      const chain = details?.traversalChain as Array<Record<string, unknown>> | undefined;
      if (details && chain) {
        return {
          summary: resp.summary
          , traversalPath: resp.traversalPath
          , details: {
            startNode: details.startNode
            , searchQuery: details.searchQuery ?? (details.searchQueries as string[] | undefined)?.join(', ') ?? ''
            , maxDepth: details.maxDepth
            , totalNodesVisited: details.totalNodesVisited
            , nodesWithMatches: chain.length
            , executionTime: details.executionTime
          }
          , snippetChain: chain.map(node => ({
            file: node.path
            , depth: node.depth ?? 0
            , parent: node.parentPath
            , snippet: node.snippet ?? { text: '', score: '0', lineNumber: 0, preview: '' }
          }))
          , workflowSuggestions: resp.workflowSuggestions ?? []
        };
      }
      return resp;
    }

    // tag-analysis: router returns {file, tags, tagConnections: {tag: [paths]}, summary, strongestConnections}
    // formatter expects {totalTags, totalFiles, tags: [{tag, count, files}]}
    case 'tag-analysis': {
      const tagConns = resp.tagConnections as Record<string, string[]> | undefined;
      const fileTags = resp.tags as string[] | undefined;
      if (fileTags && tagConns) {
        const allFiles = new Set<string>();
        const formattedTags = fileTags.map(tag => {
          const files = tagConns[tag] || [];
          files.forEach(f => allFiles.add(f));
          return { tag, count: files.length, files };
        });
        return {
          sourcePath: resp.file
          , totalTags: fileTags.length
          , totalFiles: allFiles.size
          , tags: formattedTags
          , summary: resp.summary
        };
      }
      return resp;
    }

    // shared-tags: router returns {source, target, sharedTags, connectionStrength, summary}
    // formatter expects {sourcePath, results: [{file1, file2, sharedTags, similarity}], totalMatches}
    case 'shared-tags': {
      const sharedTags = resp.sharedTags as string[] | undefined;
      if (resp.source !== undefined && resp.target !== undefined) {
        return {
          sourcePath: resp.source
          , totalMatches: sharedTags?.length ?? 0
          , results: sharedTags && sharedTags.length > 0 ? [{
            file1: resp.source as string
            , file2: resp.target as string
            , sharedTags
            , similarity: sharedTags.length > 0 ? 1.0 : 0
          }] : []
          , summary: resp.summary
        };
      }
      return resp;
    }

    default:
      return resp;
  }
}
