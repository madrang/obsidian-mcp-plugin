/**
 * Graph search parameter and result shapes shared by the graph operation
 * modules (traverse, listings, path, statistics) and the GraphSearchTool
 * facade.
 */

/**
 * Graph search parameters
 */
export interface GraphSearchParams {
  // Starting point for the search
  sourcePath?: string;

  // Target path for pathfinding operations
  targetPath?: string;

  // Type of graph operation
  operation: 'traverse' | 'neighbors' | 'path' | 'statistics' | 'backlinks' | 'forwardlinks';

  // Options for traversal
  maxDepth?: number;
  maxNodes?: number;
  includeUnresolved?: boolean;
  followBacklinks?: boolean;
  followForwardLinks?: boolean;
  followTags?: boolean;

  // Filters
  fileFilter?: string; // regex pattern for file names
  tagFilter?: string[]; // only include files with these tags
  folderFilter?: string; // only include files in this folder
}

/**
 * Graph search result
 */
export interface GraphSearchResult {
  operation: string;
  sourcePath?: string;
  targetPath?: string;
  nodes?: Array<{
    path: string;
    title: string;
    type: 'file';
    tags?: string[];
    links?: {
      forward: number;
      backward: number;
      total: number;
    };
  }>;
  edges?: Array<{
    source: string;
    target: string;
    type: 'link' | 'embed' | 'tag';
    count: number;
  }>;
  found?: boolean;
  paths?: Array<Array<{ path: string; title: string }>> | string[][];
  shortestLength?: number;
  statistics?: {
    inDegree: number;
    outDegree: number;
    totalDegree: number;
    unresolvedCount: number;
    tagCount: number;
  };
  vaultStatistics?: {
    totalNotes: number;
    totalLinks: number;
    orphanCount: number;
    averageDegree: number;
    largestComponentSize: number;
    isolatedClusters: number;
  };
  graphStats?: {
    totalNodes: number;
    totalEdges: number;
    maxDepthReached?: number;
    traversalTime?: number;
  };
  message?: string;
  workflow?: {
    message: string;
    suggested_next: Array<{
      description: string;
      command: string;
      reason: string;
    }>;
  };
}
