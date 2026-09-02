/**
 * Graph operation formatters. Per-action formatters live in ./formatters/;
 * this module owns the normalization pass and the dispatch entry the graph
 * tool registers.
 */
import { normalizeGraphResponse } from './formatters/normalize';
import { formatGraphTraverse, GraphTraverseResponse } from './formatters/traverse';
import { formatGraphNeighbors, GraphNeighborsResponse } from './formatters/neighbors';
import { formatGraphPath, GraphPathResponse } from './formatters/path';
import { formatGraphStats, GraphStatsResponse } from './formatters/stats';
import { formatTagAnalysis, TagAnalysisResponse } from './formatters/tag-analysis';
import { formatSharedTags, SharedTagsResponse } from './formatters/shared-tags';
import { formatSearchTraverse, SearchTraverseResponse } from './formatters/search-traverse';

// Direct consumers pin stats rendering (tests/formatters/graph-vault-stats.test.ts).
export { formatGraphStats } from './formatters/stats';

/**
 * The presentation entry the graph tool registers.
 */
export function formatGraphResponse(action: string, response: unknown): string | undefined {
  const normalized = normalizeGraphResponse(action, response);
  switch (action) {
    case 'traverse':
      return formatGraphTraverse(normalized as GraphTraverseResponse);
    case 'neighbors':
    case 'backlinks':
    case 'forwardlinks':
      return formatGraphNeighbors(normalized as GraphNeighborsResponse);
    case 'path':
      return formatGraphPath(normalized as GraphPathResponse);
    case 'statistics':
      return formatGraphStats(normalized as GraphStatsResponse);
    case 'search-traverse':
    case 'advanced-traverse':
    case 'tag-traverse':
      return formatSearchTraverse(normalized as SearchTraverseResponse);
    case 'tag-analysis':
      return formatTagAnalysis(normalized as TagAnalysisResponse);
    case 'shared-tags':
      return formatSharedTags(normalized as SharedTagsResponse);
    default:
      return undefined;
  }
}
