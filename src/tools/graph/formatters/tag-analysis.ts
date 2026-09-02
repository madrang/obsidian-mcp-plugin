/**
 * Formatter for graph.tag-analysis.
 */
import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../../format-utils';

export interface TagAnalysisTag {
  tag: string;
  count: number;
  files?: string[];
}

export interface TagAnalysisResponse {
  folderFilter?: string;
  totalTags: number;
  totalFiles: number;
  tags: TagAnalysisTag[];
}

export function formatTagAnalysis(response: TagAnalysisResponse): string {
  const lines: string[] = [];

  lines.push(header(1, 'Tag Analysis'));
  lines.push('');

  if (response.folderFilter) {
    lines.push(property('Folder', response.folderFilter, 0));
  }
  lines.push(property('Total Tags', response.totalTags.toString(), 0));
  lines.push(property('Total Files', response.totalFiles.toString(), 0));
  lines.push('');

  if (response.tags.length === 0) {
    lines.push('No tags found.');
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  lines.push(header(2, 'Tags by Frequency'));
  lines.push('');

  // Sort by count descending
  const sorted = [...response.tags].sort((a, b) => b.count - a.count);

  sorted.slice(0, 30).forEach((tag, i) => {
    lines.push(`${i + 1}. **${tag.tag}** (${tag.count} files)`);
    if (tag.files && tag.files.length > 0) {
      const preview = tag.files.slice(0, 3).map(f => f.split('/').pop()).join(', ');
      lines.push(`   ${preview}${tag.files.length > 3 ? '...' : ''}`);
    }
  });

  if (sorted.length > 30) {
    lines.push(`\n... and ${sorted.length - 30} more tags`);
  }

  lines.push('');
  lines.push(divider());
  lines.push(tip('Use `view.search` with query tag: "#tagname" to find files with a specific tag'));
  lines.push(summaryFooter());

  return joinLines(lines);
}
