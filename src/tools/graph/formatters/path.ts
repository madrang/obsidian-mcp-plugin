/**
 * Formatter for graph.path.
 */
import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../../format-utils';

export interface GraphPathNode {
  path: string;
  title: string;
}

export interface GraphPathResponse {
  sourcePath: string;
  targetPath: string;
  found: boolean;
  paths: GraphPathNode[][];
  shortestLength?: number;
}

export function formatGraphPath(response: GraphPathResponse): string {
  const lines: string[] = [];

  const sourceFile = response.sourcePath.split('/').pop() || response.sourcePath;
  const targetFile = response.targetPath.split('/').pop() || response.targetPath;

  lines.push(header(1, `Path: ${sourceFile} → ${targetFile}`));
  lines.push('');

  if (!response.found || response.paths.length === 0) {
    lines.push('No path found between these notes.');
    lines.push('');
    lines.push(tip('These notes may not be connected through links'));
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  lines.push(property('Paths Found', response.paths.length.toString(), 0));
  if (response.shortestLength) {
    lines.push(property('Shortest', `${response.shortestLength} hops`, 0));
  }
  lines.push('');

  // Show paths
  response.paths.slice(0, 5).forEach((path, i) => {
    lines.push(header(2, `Path ${i + 1} (${path.length - 1} hops)`));
    lines.push('');

    // ASCII visualization
    path.forEach((node, j) => {
      if (j === 0) {
        lines.push(`**${node.title}**`);
      } else {
        lines.push('  ↓');
        lines.push(`${node.title}`);
      }
    });
    lines.push('');
  });

  if (response.paths.length > 5) {
    lines.push(`... and ${response.paths.length - 5} more paths`);
  }

  lines.push(divider());
  lines.push(tip('Use `view.read(path)` to examine any node in the path'));
  lines.push(summaryFooter());

  return joinLines(lines);
}
