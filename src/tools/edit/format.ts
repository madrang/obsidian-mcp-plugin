/**
 * Edit operation formatters: the result rendering for replace, append,
 * patch, at_line, and multi.
 */

import {
  header,
  property,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../format-utils';

/**
 * Format edit operation responses
 * Note: Response may only contain success status
 */
export interface EditResponse {
  success?: boolean;
  path?: string;
  operation?: 'replace' | 'append' | 'patch' | 'at_line' | 'multi';
  linesChanged?: number;
  /** edit.multi: number of pairs applied in the single write. */
  applied?: number;
  message?: string;
  /** Post-write stat: echo back as the edit ifUnmodifiedSince / ifHash
   * precondition to chain writes without re-reading. */
  mtime?: number;
  hash?: string;
}

export function formatEditResult(response: EditResponse): string {
  const lines: string[] = [];

  // Handle minimal response (just success)
  const success = response.success ?? true;
  const icon = success ? '✓' : '✗';

  // Determine verb from operation if available
  let verb = 'Edited';
  if (response.operation) {
    verb = response.operation === 'replace' ? 'Replaced'
      : response.operation === 'append' ? 'Appended'
      : response.operation === 'patch' ? 'Patched'
      : 'Edited';
  }

  const pathDisplay = response.path || 'file';
  lines.push(header(1, `${icon} ${verb}: ${pathDisplay}`));
  lines.push('');

  if (success) {
    lines.push('Edit successful.');
    if (response.linesChanged !== undefined) {
      lines.push(property('Lines Changed', response.linesChanged.toString(), 0));
    }
    if (response.applied !== undefined) {
      lines.push(property('Pairs Applied', response.applied.toString(), 0));
    }
    if (response.mtime !== undefined) {
      lines.push(property('Modified', response.mtime.toString(), 0));
    }
    if (response.hash !== undefined) {
      lines.push(property('Hash', response.hash, 0));
    }
  } else {
    lines.push(`Edit failed${response.message ? `: ${response.message}` : ''}`);
  }

  lines.push(divider());
  if (success && response.hash !== undefined) {
    lines.push(tip('Pass the new hash as `ifHash` on the next edit to chain writes without re-reading'));
  } else {
    lines.push(tip('Use `view.read(path)` to verify the changes'));
  }
  lines.push(summaryFooter());

  return joinLines(lines);
}
