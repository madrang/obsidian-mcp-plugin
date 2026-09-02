/**
 * Formatter for graph.statistics, both the per-note and the vault-wide
 * shape. Actual response: { operation, sourcePath, statistics: {...}, message, workflow }
 */
import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../../format-utils';

export interface GraphStatsResponse {
  // Absent for the vault-wide call (graph.statistics with no sourcePath).
  sourcePath?: string;
  // Flat format (legacy)
  inDegree?: number;
  outDegree?: number;
  totalDegree?: number;
  isOrphan?: boolean;
  // Nested format (actual)
  statistics?: {
    inDegree: number;
    outDegree: number;
    totalDegree: number;
    unresolvedCount?: number;
    tagCount?: number;
  };
  // Vault-wide format — a different shape entirely, returned when no sourcePath is given.
  vaultStatistics?: {
    totalNotes: number;
    totalLinks: number;
    orphanCount: number;
    averageDegree: number;
    largestComponentSize?: number;
    isolatedClusters?: number;
  };
  message?: string;
}

export function formatGraphStats(response: GraphStatsResponse): string {
  const lines: string[] = [];

  // Vault-wide statistics carry no sourcePath. Reading one unconditionally threw and
  // dropped the caller into the raw-JSON fallback.
  if (response.vaultStatistics) {
    return formatVaultGraphStats(response.vaultStatistics);
  }

  const sourcePath = response.sourcePath ?? '';
  const fileName = sourcePath.split('/').pop() || sourcePath || 'vault';
  lines.push(header(1, `Stats: ${fileName}`));
  lines.push('');

  if (response.message) {
    lines.push(response.message);
    lines.push('');
  }

  // Handle both nested and flat formats
  const stats = response.statistics || response;
  const inDegree = stats.inDegree ?? 0;
  const outDegree = stats.outDegree ?? 0;
  const totalDegree = stats.totalDegree ?? (inDegree + outDegree);

  lines.push(property('Incoming Links', inDegree.toString(), 0));
  lines.push(property('Outgoing Links', outDegree.toString(), 0));
  lines.push(property('Total Connections', totalDegree.toString(), 0));

  if (response.statistics?.unresolvedCount) {
    lines.push(property('Unresolved', response.statistics.unresolvedCount.toString(), 0));
  }
  if (response.statistics?.tagCount) {
    lines.push(property('Tags', response.statistics.tagCount.toString(), 0));
  }

  const isOrphan = response.isOrphan ?? (totalDegree === 0);
  if (isOrphan) {
    lines.push('');
    lines.push('⚠️ This note is an orphan (no incoming or outgoing links)');
  }

  lines.push(divider());
  lines.push(tip('Use `graph.neighbors(path)` to see the actual connections'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format the vault-wide graph statistics (graph.statistics with no sourcePath).
 *
 * Average degree is the headline number because it tells the caller which retrieval
 * strategy will actually pay here: in a densely linked vault, following links from a
 * couple of anchor notes beats issuing more searches.
 */
function formatVaultGraphStats(stats: NonNullable<GraphStatsResponse['vaultStatistics']>): string {
  const lines: string[] = [];

  lines.push(header(1, 'Vault graph'));
  lines.push('');
  lines.push(property('Notes', stats.totalNotes.toString(), 0));
  lines.push(property('Links', stats.totalLinks.toString(), 0));
  lines.push(property('Average connections per note', stats.averageDegree.toFixed(1), 0));
  lines.push(property('Orphans', stats.orphanCount.toString(), 0));

  if (stats.largestComponentSize !== undefined) {
    lines.push(property('Largest connected component', `${stats.largestComponentSize} notes`, 0));
  }
  if (stats.isolatedClusters !== undefined) {
    lines.push(property('Separate clusters', stats.isolatedClusters.toString(), 0));
  }

  lines.push('');
  lines.push(divider());

  if (stats.averageDegree >= 3) {
    lines.push(`This vault is densely linked (${stats.averageDegree.toFixed(1)} links per note on average). Its link structure is a stronger signal than keyword frequency:`);
    lines.push(tip('Find one or two anchor notes with `view.search`, then expand with `graph.neighbors(path)` / `graph.traverse(path)` rather than issuing more searches'));
  } else {
    lines.push(tip('Sparsely linked vault — `view.search` will usually outperform graph traversal here'));
  }

  lines.push(summaryFooter());

  return joinLines(lines);
}
