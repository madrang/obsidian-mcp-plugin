/**
 * Formatter for graph.neighbors (also backlinks and forwardlinks).
 * Actual response has: nodes[], edges[], message, workflow
 */
import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../../format-utils';

export interface GraphNeighborsNode {
  path: string;
  title: string;
  type: string;
  tags?: string[];
  links?: { forward: number; backward: number; total: number };
}

export interface GraphNeighborsEdge {
  source: string;
  target: string;
  type: string;
  count: number;
}

export interface GraphNeighborsResponse {
  sourcePath: string;
  nodes: GraphNeighborsNode[];
  edges: GraphNeighborsEdge[];
  message?: string;
}

export function formatGraphNeighbors(response: GraphNeighborsResponse): string {
  const lines: string[] = [];

  const fileName = response.sourcePath.split('/').pop() || response.sourcePath;
  lines.push(header(1, `Neighbors: ${fileName}`));
  lines.push('');

  if (response.message) {
    lines.push(response.message);
    lines.push('');
  }

  // Source node (first node is usually the source)
  const sourceNode = response.nodes.find(n => n.path === response.sourcePath);
  const neighbors = response.nodes.filter(n => n.path !== response.sourcePath);

  if (sourceNode?.tags && sourceNode.tags.length > 0) {
    lines.push(property('Tags', sourceNode.tags.join(', '), 0));
    lines.push('');
  }

  // Connected nodes
  lines.push(header(2, `Connected Notes (${neighbors.length})`));
  if (neighbors.length === 0) {
    lines.push('No direct connections');
  } else {
    neighbors.slice(0, 20).forEach(node => {
      const linkInfo = node.links ? ` (${node.links.total} connections)` : '';
      lines.push(`- **${node.title}**${linkInfo}`);
      lines.push(`  ${node.path}`);
    });
    if (neighbors.length > 20) {
      lines.push(`... and ${neighbors.length - 20} more`);
    }
  }
  lines.push('');

  // Edge summary
  if (response.edges.length > 0) {
    const outgoing = response.edges.filter(e => e.source === response.sourcePath);
    const incoming = response.edges.filter(e => e.target === response.sourcePath);
    lines.push(property('Outgoing', outgoing.length.toString(), 0));
    lines.push(property('Incoming', incoming.length.toString(), 0));
  }

  lines.push(divider());
  lines.push(tip('Use `graph.traverse(path)` to explore deeper connections'));
  lines.push(summaryFooter());

  return joinLines(lines);
}
