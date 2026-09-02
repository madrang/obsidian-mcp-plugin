/**
 * Formatter for graph.search-traverse, advanced-traverse, and tag-traverse.
 */
import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../../format-utils';

export interface SearchTraverseSnippet {
  text: string;
  score: string | number;
  lineNumber: number;
  preview: string;
}

export interface SearchTraverseNode {
  file: string;
  depth: number;
  parent?: string;
  connectionType?: string;
  snippet: SearchTraverseSnippet;
}

export interface SearchTraverseResponse {
  summary: string;
  traversalPath: string;
  details: {
    startNode: string;
    searchQuery: string;
    maxDepth: number;
    totalNodesVisited: number;
    nodesWithMatches: number;
    executionTime: string;
    tagConnectionsFollowed?: number;
  };
  snippetChain: SearchTraverseNode[];
  workflowSuggestions: string[];
}

export function formatSearchTraverse(response: SearchTraverseResponse): string {
  const lines: string[] = [];

  lines.push(header(1, `Search Traverse: "${response.details.searchQuery}"`));
  lines.push('');
  lines.push(response.summary);
  lines.push('');

  lines.push(property('Start', response.details.startNode, 0));
  lines.push(property('Depth', response.details.maxDepth.toString(), 0));
  lines.push(property('Visited', response.details.totalNodesVisited.toString(), 0));
  lines.push(property('Matches', response.details.nodesWithMatches.toString(), 0));
  lines.push(property('Time', response.details.executionTime, 0));
  if (response.details.tagConnectionsFollowed) {
    lines.push(property('Tag Connections', response.details.tagConnectionsFollowed.toString(), 0));
  }
  lines.push('');

  if (response.snippetChain.length === 0) {
    lines.push('No matching snippets found along the traversal path.');
    lines.push('');
    lines.push(tip('Try broadening your search query or increasing maxDepth'));
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  lines.push(header(2, 'Traversal Path'));
  lines.push('');

  // Render each node in the chain with its snippet
  response.snippetChain.forEach((node, i) => {
    const indent = '  '.repeat(node.depth);
    const icon = i === 0 ? '**[start]**' : node.connectionType === 'tag' ? '**[tag]**' : '**[link]**';
    const fileName = node.file.split('/').pop() || node.file;
    const score = typeof node.snippet.score === 'number'
      ? node.snippet.score.toFixed(3)
      : node.snippet.score;

    lines.push(`${indent}${icon} **${fileName}** (score: ${score}, line ${node.snippet.lineNumber})`);
    lines.push(`${indent}  ${node.file}`);

    // Show snippet preview as indented quote
    const preview = node.snippet.preview || node.snippet.text;
    const previewLines = preview.split('\n').slice(0, 3);
    previewLines.forEach(line => {
      lines.push(`${indent}  > ${line}`);
    });

    if (i < response.snippetChain.length - 1) {
      lines.push(`${indent}  ↓`);
    }
    lines.push('');
  });

  // Workflow suggestions
  if (response.workflowSuggestions.length > 0) {
    lines.push(divider());
    response.workflowSuggestions.forEach(suggestion => {
      lines.push(tip(suggestion));
    });
  }

  lines.push(summaryFooter());

  return joinLines(lines);
}
