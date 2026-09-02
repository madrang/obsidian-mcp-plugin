/**
 * Formatter for graph.shared-tags.
 */
import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../../format-utils';

export interface SharedTagsResult {
  file1: string;
  file2: string;
  sharedTags: string[];
  similarity: number;
}

export interface SharedTagsResponse {
  sourcePath: string;
  results: SharedTagsResult[];
  totalMatches: number;
}

export function formatSharedTags(response: SharedTagsResponse): string {
  const lines: string[] = [];

  const fileName = response.sourcePath.split('/').pop() || response.sourcePath;
  lines.push(header(1, `Shared Tags: ${fileName}`));
  lines.push('');
  lines.push(property('Source', response.sourcePath, 0));
  lines.push(property('Matches', response.totalMatches.toString(), 0));
  lines.push('');

  if (response.results.length === 0) {
    lines.push('No files share tags with this file.');
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  lines.push(header(2, 'Related Files'));
  lines.push('');

  response.results.slice(0, 20).forEach((result, i) => {
    const otherFile = result.file1 === response.sourcePath ? result.file2 : result.file1;
    const otherName = otherFile.split('/').pop() || otherFile;
    const similarity = Math.round(result.similarity * 100);

    lines.push(`${i + 1}. **${otherName}** (${similarity}% similar)`);
    lines.push(`   Shared: ${result.sharedTags.slice(0, 5).join(', ')}${result.sharedTags.length > 5 ? '...' : ''}`);
  });

  if (response.results.length > 20) {
    lines.push(`\n... and ${response.results.length - 20} more matches`);
  }

  lines.push('');
  lines.push(divider());
  lines.push(tip('Use `graph.path(source, target)` to find connection paths between files'));
  lines.push(summaryFooter());

  return joinLines(lines);
}
