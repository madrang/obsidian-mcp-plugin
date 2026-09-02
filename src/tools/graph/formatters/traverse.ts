/**
 * Formatter for graph.traverse.
 */
import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../../format-utils';

export interface GraphNode {
  path: string;
  title: string;
  depth: number;
  links?: string[];
  backlinks?: string[];
}

export interface GraphTraverseResponse {
  sourcePath: string;
  maxDepth: number;
  nodes: GraphNode[];
  totalNodes: number;
}

export function formatGraphTraverse(response: GraphTraverseResponse): string {
  const lines: string[] = [];

  const fileName = response.sourcePath.split('/').pop() || response.sourcePath;
  lines.push(header(1, `Graph: ${fileName}`));
  lines.push('');
  lines.push(property('Source', response.sourcePath, 0));
  lines.push(property('Max Depth', response.maxDepth.toString(), 0));
  lines.push(property('Nodes Found', response.totalNodes.toString(), 0));
  lines.push('');

  // Group by depth
  const byDepth = new Map<number, GraphNode[]>();
  response.nodes.forEach(node => {
    const nodes = byDepth.get(node.depth) || [];
    nodes.push(node);
    byDepth.set(node.depth, nodes);
  });

  // Display hierarchy
  for (let depth = 0; depth <= response.maxDepth; depth++) {
    const nodesAtDepth = byDepth.get(depth) || [];
    if (nodesAtDepth.length === 0) continue;

    lines.push(header(2, `Depth ${depth}`));
    nodesAtDepth.slice(0, 15).forEach(node => {
      const indent = '  '.repeat(depth);
      lines.push(`${indent}- ${node.title}`);
      if (node.links && node.links.length > 0) {
        lines.push(`${indent}  → links to: ${node.links.slice(0, 3).join(', ')}${node.links.length > 3 ? '...' : ''}`);
      }
    });
    if (nodesAtDepth.length > 15) {
      lines.push(`  ... and ${nodesAtDepth.length - 15} more at this depth`);
    }
    lines.push('');
  }

  lines.push(divider());
  lines.push(tip('Use `graph.neighbors(path)` for immediate connections only'));
  lines.push(tip('Use `graph.path(source, target)` to find routes between specific notes'));
  lines.push(summaryFooter());

  return joinLines(lines);
}
