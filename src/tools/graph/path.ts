/**
 * graph path. Shortest path first, then all paths up to maxDepth when the
 * caller asks deeper. The facade never filters a found chain: hiding its
 * middle nodes would corrupt it.
 */
import { GraphTraversal } from '../../utils/graph-traversal';
import { GraphSearchParams, GraphSearchResult } from './types';

/**
 * Find path(s) between two nodes
 */
export function findPath(traversal: GraphTraversal, params: GraphSearchParams): GraphSearchResult {
  if (!params.sourcePath || !params.targetPath) {
    throw new Error('Both source and target paths are required for path operation');
  }

  // First try shortest path
  const shortestPath = traversal.findShortestPath(
    params.sourcePath,
    params.targetPath,
    { followBacklinks: params.followBacklinks !== false }
  );

  let rawPaths: string[][] = [];
  if (shortestPath) {
    rawPaths.push(shortestPath);

    // Optionally find all paths if requested
    if (params.maxDepth && params.maxDepth > shortestPath.length) {
      const allPaths = traversal.findAllPaths(
        params.sourcePath,
        params.targetPath,
        params.maxDepth
      );
      rawPaths = allPaths.slice(0, 10); // Limit to 10 paths
    }
  }

  // Convert string paths to node objects for the formatter
  const paths = rawPaths.map(pathList =>
    pathList.map(filePath => ({
      path: filePath
      , title: traversal.getNodeTitleForPath(filePath)
    }))
  );

  return {
    operation: 'path'
    , sourcePath: params.sourcePath
    , targetPath: params.targetPath
    , found: paths.length > 0
    , paths
    , shortestLength: paths.length > 0 ? paths[0].length - 1 : undefined
    , message: paths.length > 0
      ? `Found ${paths.length} path(s) between files. Shortest path has ${paths[0].length} nodes.`
      : 'No path found between the specified files'
    , workflow: {
      message: paths.length > 0
        ? 'Paths found. You can view the files along any path.'
        : 'No connection found. Try increasing search depth or following backlinks.'
      , suggested_next: paths.length > 0 ? [
        {
          description: 'View files in the path'
          , command: 'view:file'
          , reason: 'To examine the content of files connecting the source and target'
        }
        , {
          description: 'Get statistics for path nodes'
          , command: 'graph:statistics'
          , reason: 'To understand the connectivity of intermediate nodes'
        }
      ] : [
        {
          description: 'Traverse from source with more depth'
          , command: 'graph:traverse'
          , reason: 'To explore the broader network around the source file'
        }
      ]
    }
  };
}
