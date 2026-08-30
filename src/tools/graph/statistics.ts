/**
 * graph statistics. Link statistics — vault-wide when sourcePath is
 * omitted (#132), per-node when sourcePath is provided.
 */
import { App, TFile } from 'obsidian';
import { GraphTraversal } from '../../utils/graph-traversal';
import { GraphSearchParams, GraphSearchResult } from './types';

/**
 * Get link statistics — vault-wide when sourcePath is omitted (#132),
 * per-node when sourcePath is provided.
 */
export function getStatistics(traversal: GraphTraversal, app: App, params: GraphSearchParams): GraphSearchResult {
  if (!params.sourcePath) {
    const vaultStats = traversal.getVaultStatistics();
    return {
      operation: 'statistics'
      , vaultStatistics: vaultStats
      , message: `Vault-wide statistics: ${vaultStats.totalNotes} notes, ${vaultStats.totalLinks} links, ${vaultStats.orphanCount} orphans, ${vaultStats.isolatedClusters} components`
      , workflow: {
        message: 'Vault statistics retrieved. You can drill into specific files or explore the largest component.'
        , suggested_next: [
          {
            description: 'Get per-node statistics for a specific file'
            , command: 'graph:statistics'
            , reason: 'Pass sourcePath to see degree/tag counts for one note'
          }
          , {
            description: 'Traverse from a known hub'
            , command: 'graph:traverse'
            , reason: 'Explore the connected structure of the largest component'
          }
        ]
      }
    };
  }

  const stats = traversal.getNodeStatistics(params.sourcePath);
  const file = app.vault.getAbstractFileByPath(params.sourcePath);
  const title = file instanceof TFile
    ? traversal.getNodeTitle(file)
    : params.sourcePath;

  return {
    operation: 'statistics'
    , sourcePath: params.sourcePath
    , statistics: stats
    , message: `Link statistics for ${title}`
    , workflow: {
      message: 'Statistics retrieved. You can explore the actual links or find connected nodes.'
      , suggested_next: [
        {
          description: 'Get backlinks'
          , command: 'graph:backlinks'
          , reason: `To see the ${stats.inDegree} files linking to this file`
        }
        , {
          description: 'Get forward links'
          , command: 'graph:forwardlinks'
          , reason: `To see the ${stats.outDegree} files this file links to`
        }
        , {
          description: 'Get neighbors'
          , command: 'graph:neighbors'
          , reason: 'To see all directly connected files'
        }
      ]
    }
  };
}
