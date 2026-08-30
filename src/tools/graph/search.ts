/**
 * Tool for searching and traversing the Obsidian vault graph. The facade:
 * it owns the traversal instance and the exclusion guard, and dispatches
 * to the per-operation modules (traverse, listings, path, statistics).
 */
import { ObsidianAPI } from '../../utils/obsidian-api';
import { GraphTraversal } from '../../utils/graph-traversal';
import { App } from 'obsidian';
import { GraphSearchParams, GraphSearchResult } from './types';
import { performTraversal } from './traverse';
import { getStatistics } from './statistics';
import { applyListingFilters, getNeighbors, getBacklinks, getForwardLinks } from './listings';
import { findPath } from './path';

export class GraphSearchTool {
  private graphTraversal: GraphTraversal;

  constructor(private api: ObsidianAPI, private app: App) {
    this.graphTraversal = new GraphTraversal(app, api.getIgnoreManager());
  }

  /** Throw "File not found" for an ignored query root ('/' and '' are the virtual root). */
  private assertNotExcluded(path?: string): void {
    if (!path || path === '/') return;
    if (this.graphTraversal.isExcluded(path)) {
      throw new Error(`File not found: ${path}`);
    }
  }

  /**
   * Execute a graph search operation
   */
  search(params: GraphSearchParams): GraphSearchResult {
    const { operation } = params;

    // Reject excluded query roots so directly targeting an ignored note does
    // not disclose its relationships. Excluded paths are treated as not found,
    // matching ObsidianAPI's read-path behavior. The '/' and '' sentinels are
    // the virtual vault root, not real paths.
    this.assertNotExcluded(params.sourcePath);
    this.assertNotExcluded(params.targetPath);

    const result = this.dispatch(operation, params);

    // Listing filters. traverse applies the filters during the walk itself
    // (performTraversal), so the walk never enters a filtered note. path is a
    // found chain: hiding its middle nodes would corrupt it. statistics
    // counts globally. The three listing actions filter the returned nodes
    // and edges.
    if (operation === 'neighbors' || operation === 'backlinks' || operation === 'forwardlinks') {
      return applyListingFilters(params, result);
    }
    return result;
  }

  private dispatch(operation: GraphSearchParams['operation'], params: GraphSearchParams): GraphSearchResult {
    switch (operation) {
      case 'traverse':
        return performTraversal(this.graphTraversal, this.app, params);
      case 'neighbors':
        return getNeighbors(this.graphTraversal, params);
      case 'path':
        return findPath(this.graphTraversal, params);
      case 'statistics':
        return getStatistics(this.graphTraversal, this.app, params);
      case 'backlinks':
        return getBacklinks(this.graphTraversal, this.app, params);
      case 'forwardlinks':
        return getForwardLinks(this.graphTraversal, this.app, params);
      default: {
        const exhaustiveCheck: never = operation;
        throw new Error(`Unknown graph operation: ${String(exhaustiveCheck)}`);
      }
    }
  }
}
