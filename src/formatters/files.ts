/**
 * File operation formatters: the files tool writes (create, delete, move,
 * copy, split, concat) and the view tool reads (folder, read).
 */

import {
  header,
  property,
  truncate,
  formatFileSize,
  formatDate,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../tools/format-utils';

/**
 * Format file list results
 */
export interface FileListItem {
  path: string;
  name: string;
  isFolder?: boolean;
  size?: number;
  modified?: number;
}

export interface FileListResponse {
  directory: string;
  files: FileListItem[];
  totalFiles?: number;
  totalFolders?: number;
  // Pagination metadata when listFilesPaginated is the underlying call.
  page?: number;
  pageSize?: number;
  totalPages?: number;
  // The glob filter active on the listing (view.folder pattern param).
  pattern?: string;
}

export function formatFileList(response: FileListResponse | string[]): string {
  const lines: string[] = [];

  // Handle simple string array response
  if (Array.isArray(response)) {
    const paths = response;
    const truncateAt = 50;
    lines.push(header(1, 'Files'));
    lines.push('');
    lines.push(`Found ${paths.length} item${paths.length !== 1 ? 's' : ''}`);
    lines.push('');

    // Full vault-relative path, not the basename. A listing that shows only names
    // invites the agent to join them onto the directory it asked for, which
    // fabricates a path when the entries actually live in nested subdirectories.
    paths.slice(0, truncateAt).forEach(path => {
      const isFolder = !path.split('/').pop()?.includes('.');
      lines.push(`- ${isFolder ? path + '/' : path}`);
    });

    if (paths.length > truncateAt) {
      lines.push(`- ... and ${paths.length - truncateAt} more`);
      lines.push('');
      // Surface a concrete next call so an agent that needs items past
      // the truncation point doesn't have to guess.
      lines.push(tip(`Showing first ${truncateAt} of ${paths.length}. Call again with \`page=2 pageSize=${truncateAt}\` to continue, or \`raw: true\` to receive the full list in one response.`));
    }

    lines.push('');
    lines.push(divider());
    lines.push(tip('Use `view.read(path)` to read file contents'));
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  // Handle structured response
  const { directory, files, totalFiles, totalFolders, page, pageSize, totalPages, pattern } = response;

  lines.push(header(1, `Directory: ${directory || '/'}`));
  if (pattern !== undefined) {
    lines.push('');
    lines.push(property('Pattern', pattern, 0));
  }
  lines.push('');

  const folders = files.filter(f => f.isFolder);
  const regularFiles = files.filter(f => !f.isFolder);

  // Summary — show pagination state when present so the agent sees what
  // slice of the universe it's looking at.
  const summaryParts: string[] = [];
  if (totalFolders !== undefined || folders.length > 0) {
    summaryParts.push(`${totalFolders ?? folders.length} folders`);
  }
  if (totalFiles !== undefined || regularFiles.length > 0) {
    summaryParts.push(`${totalFiles ?? regularFiles.length} files`);
  }
  if (summaryParts.length > 0) {
    lines.push(summaryParts.join(', '));
    lines.push('');
  }
  if (page !== undefined && totalPages !== undefined && totalPages > 0) {
    lines.push(`Page ${page} of ${totalPages} (${files.length} items${pageSize ? `, ${pageSize} char budget` : ''})`);
    lines.push('');
  }

  // Entries are listed by full vault-relative path, never by basename alone: the path
  // is what the agent passes to the next call, and a nested entry shown as a bare name
  // reads as though it sits directly under `directory`, which it may not.

  // Folders first
  if (folders.length > 0) {
    lines.push(header(2, 'Folders'));
    folders.slice(0, 20).forEach(f => {
      lines.push(`- ${f.path}/`);
    });
    if (folders.length > 20) {
      lines.push(`- ... and ${folders.length - 20} more folders`);
    }
    lines.push('');
  }

  // Files
  if (regularFiles.length > 0) {
    lines.push(header(2, 'Files'));
    regularFiles.slice(0, 30).forEach(f => {
      const sizeText = f.size !== undefined ? ` (${formatFileSize(f.size)})` : '';
      lines.push(`- ${f.path}${sizeText}`);
    });
    if (regularFiles.length > 30) {
      lines.push(`- ... and ${regularFiles.length - 30} more files`);
    }
    lines.push('');
  }

  // Empty result under a filter gets an explicit statement, so the agent
  // reads "the glob matched nothing" instead of scanning a bare listing.
  // Only when the whole universe is empty: a past-end page also carries no
  // items, but the filter did match — the header already says "Page N of M".
  if (pattern !== undefined && files.length === 0 && (totalFiles ?? 0) === 0) {
    lines.push(`No files match \`${pattern}\`.`);
    lines.push('');
  }

  // Concrete next-call hint when there are more pages — agent doesn't
  // have to guess at the next move. The pattern must ride along, or page 2
  // would come back unfiltered.
  if (page !== undefined && totalPages !== undefined && page < totalPages) {
    const dirArg = directory ? `path='${directory}', ` : '';
    const patternArg = pattern ? `pattern='${pattern}', ` : '';
    const sizeArg = pageSize ? `, pageSize=${pageSize}` : '';
    lines.push(tip(`More results available. Call \`view.folder(${dirArg}${patternArg}page=${page + 1}${sizeArg})\` for the next page.`));
    lines.push('');
  }

  lines.push(divider());
  lines.push(tip('Use `view.read(path)` to read a file, or `view.folder(path)` to explore a folder'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format file read response
 * Actual response can have content as string OR array of fragments
 */
export interface FileReadFragment {
  id: string;
  content: string;
  lineStart: number;
  lineEnd: number;
  score?: number;
}

export interface FileReadResponse {
  path?: string;
  content: string | FileReadFragment[];
  metadata?: {
    size?: number;
    modified?: number;
    created?: number;
    extension?: string;
    totalLines?: number;
    bytes?: number;
  };
  frontmatter?: Record<string, unknown>;
  tags?: string[];
  originalContentLength?: number;
  fragmentMetadata?: {
    totalFragments: number;
    strategy: string;
    query?: string;
  };
  pagination?: {
    paginated: boolean;
    page: number;
    pageLineStart: number;
    pageLineEnd: number;
    totalLines: number;
    bytes: number;
    hasMore: boolean;
    nextPage: string | null;
    oversizedLine?: boolean;
    beyondEnd?: boolean;
  };
  warning?: string;
}

export function formatFileRead(response: FileReadResponse): string {
  const { path, content, metadata, frontmatter, tags, fragmentMetadata, pagination } = response;
  const lines: string[] = [];

  const safePath = path || 'file';
  const fileName = safePath.split('/').pop() || safePath;
  lines.push(header(1, `File: ${fileName}`));
  lines.push('');

  // Metadata summary
  lines.push(property('Path', safePath, 0));
  if (metadata && typeof metadata.size === 'number') {
    lines.push(property('Size', formatFileSize(metadata.size), 0));
  }
  if (metadata && typeof metadata.modified === 'number') {
    lines.push(property('Modified', formatDate(metadata.modified), 0));
  }
  if (metadata && typeof metadata.totalLines === 'number') {
    lines.push(property('Lines', String(metadata.totalLines), 0));
  }

  // Tags
  if (tags && tags.length > 0) {
    lines.push(property('Tags', tags.slice(0, 10).join(', '), 0));
    if (tags.length > 10) {
      lines.push(`   ... and ${tags.length - 10} more tags`);
    }
  }

  // Frontmatter summary — skipped when the body already carries the raw frontmatter
  // block, which is the normal case for a whole-note read. Printing a truncated summary
  // of text that is reproduced verbatim a few lines below costs tokens on the most
  // frequently called action and tells the reader nothing new.
  const bodyRepeatsFrontmatter = typeof content === 'string' && content.trimStart().startsWith('---');

  if (frontmatter && Object.keys(frontmatter).length > 0 && !bodyRepeatsFrontmatter) {
    lines.push('');
    lines.push(header(2, 'Frontmatter'));
    const keys = Object.keys(frontmatter).slice(0, 10);
    keys.forEach(key => {
      const value = frontmatter[key];
      let displayValue: string;
      if (value === null || value === undefined) {
        displayValue = String(value);
      } else if (typeof value === 'object') {
        displayValue = JSON.stringify(value).substring(0, 50);
      } else {
        // Primitives (string, number, boolean, bigint, symbol) are safe to stringify
        const primitive = value as string | number | boolean | bigint | symbol;
        displayValue = String(primitive).substring(0, 50);
      }
      lines.push(property(key, displayValue, 0));
    });
    if (Object.keys(frontmatter).length > 10) {
      lines.push(`... and ${Object.keys(frontmatter).length - 10} more fields`);
    }
  }

  // Content - handle both string and fragment array formats
  lines.push('');

  if (content != null && typeof content !== 'string' && !Array.isArray(content)) {
    // Unrecognized/binary structured passthrough — render a safe note
    // instead of falling through to the _Formatter error_ fallback.
    lines.push(header(2, 'Content'));
    lines.push('');
    lines.push('_(non-text content; use `raw: true` for the structured payload)_');
    lines.push(divider());
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  if (Array.isArray(content)) {
    // Fragment-based response
    const fragments = content;
    if (fragmentMetadata) {
      lines.push(header(2, `Content (${fragmentMetadata.totalFragments} fragment${fragmentMetadata.totalFragments !== 1 ? 's' : ''})`));
    } else {
      lines.push(header(2, 'Content'));
    }
    lines.push('');

    fragments.slice(0, 5).forEach((frag, i) => {
      lines.push(`**Fragment ${i + 1}** (lines ${frag.lineStart}-${frag.lineEnd})`);
      lines.push('```markdown');
      lines.push(truncate(frag.content, 500));
      lines.push('```');
      lines.push('');
    });

    if (fragments.length > 5) {
      lines.push(`... and ${fragments.length - 5} more fragments`);
    }
  } else {
    // Verbatim string content (ADR-203: content reads are faithful by
    // default — the formatted default path must NOT truncate, or an agent
    // cannot derive a byte-matching edit.replace oldText without raw:true,
    // which is the exact #133 friction this ADR retires). The data layer
    // already bounds size to READ_PAGE_CHARS (or it's an explicit
    // returnFullFile override), so emitting the full block is safe. No
    // wrapping code fence: the body may itself contain ``` fences, and a
    // wrapper would corrupt round-trip fidelity.
    lines.push(header(2, 'Content'));
    lines.push('');
    lines.push(content);
  }

  if (pagination && pagination.paginated) {
    lines.push('');
    lines.push(header(2, 'Pagination'));
    lines.push(property('Page', `${pagination.page} (lines ${pagination.pageLineStart}-${pagination.pageLineEnd} of ${pagination.totalLines})`, 0));
    if (pagination.hasMore && pagination.nextPage) {
      lines.push(property('Next', pagination.nextPage, 0));
    }
    if (pagination.beyondEnd) {
      lines.push('   (requested page is past end of file)');
    }
    lines.push('   returnFullFile=true for the whole file · query/strategy with page/pageSize for fragments · line numbers are absolute (edit.at_line works)');
  }

  if (response.warning) {
    lines.push('');
    lines.push(`> ${response.warning}`);
  }

  lines.push(divider());
  lines.push(tip('Use `view.read(path)` for full content or `view.window(path, lineNumber)` for a section'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format file write/create response
 */
export interface FileWriteResponse {
  path: string;
  success: boolean;
  created?: boolean;
  overwritten?: boolean;
  size?: number;
}

export function formatFileWrite(response: FileWriteResponse, action: 'create' | 'update'): string {
  const lines: string[] = [];

  // A create with overwrite=true routes through updateFile internally. Saying
  // "Created" for it would mislabel a content replacement (same class of
  // misleading message as the #210 "Updated: undefined").
  const verb = action === 'update' || response.overwritten === true ? 'Updated' : 'Created';
  const icon = response.success ? '✓' : '✗';

  lines.push(header(1, `${icon} ${verb}: ${response.path}`));
  lines.push('');

  if (response.success) {
    lines.push(`Successfully ${verb.toLowerCase()} file.`);
    if (response.size !== undefined) {
      lines.push(property('Size', formatFileSize(response.size), 0));
    }
  } else {
    lines.push(`Failed to ${action} file.`);
  }

  lines.push(divider());
  lines.push(tip('Use `view.read(path)` to verify the content'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format file delete response
 * Note: path may not be in result, just success status
 */
export interface FileDeleteResponse {
  path?: string;
  success: boolean;
}

export function formatFileDelete(response: FileDeleteResponse): string {
  const lines: string[] = [];

  const icon = response.success ? '✓' : '✗';
  const pathDisplay = response.path || 'file';
  lines.push(header(1, `${icon} Deleted: ${pathDisplay}`));
  lines.push('');

  if (response.success) {
    lines.push('File successfully deleted.');
  } else {
    lines.push('Failed to delete file.');
  }

  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format file move/rename/copy response
 */
export interface FileMoveResponse {
  source: string;
  destination: string;
  success: boolean;
  operation: 'move' | 'rename' | 'copy';
}

export function formatFileMove(response: FileMoveResponse): string {
  const lines: string[] = [];

  const icon = response.success ? '✓' : '✗';
  const verb = response.operation.charAt(0).toUpperCase() + response.operation.slice(1);
  const pastTense: Record<string, string> = { move: 'moved', rename: 'renamed', copy: 'copied' };

  lines.push(header(1, `${icon} ${verb}: ${response.source}`));
  lines.push('');

  if (response.success) {
    lines.push(property('From', response.source, 0));
    lines.push(property('To', response.destination, 0));
    lines.push('');
    lines.push(`Successfully ${pastTense[response.operation] ?? response.operation}.`);
  } else {
    lines.push(`Failed to ${response.operation} file.`);
  }

  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format file split response
 */
export interface FileSplitResponse {
  success: boolean;
  sourceFile: string;
  // Entries carry the handler's shape ({path, lines, size}), not bare paths.
  createdFiles: Array<{ path: string; lines: number; size: number }>;
  totalFiles: number;
  splitBy?: string;
}

export function formatFileSplit(response: FileSplitResponse): string {
  const lines: string[] = [];

  const icon = response.success ? '✓' : '✗';
  lines.push(header(1, `${icon} Split: ${response.sourceFile}`));
  lines.push('');

  if (response.success) {
    lines.push(property('Source', response.sourceFile, 0));
    lines.push(property('Created', `${response.totalFiles} files`, 0));
    if (response.splitBy) {
      lines.push(property('Split by', response.splitBy, 0));
    }
    lines.push('');

    lines.push(header(2, 'Created Files'));
    response.createdFiles.slice(0, 20).forEach(file => {
      const name = file.path.split('/').pop() || file.path;
      lines.push(`- ${name}`);
    });
    if (response.createdFiles.length > 20) {
      lines.push(`- ... and ${response.createdFiles.length - 20} more`);
    }
  } else {
    lines.push('Failed to split file.');
  }

  lines.push('');
  lines.push(divider());
  lines.push(tip('Use `view.read(path)` to read any of the created files'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format file combine/concatenate response
 */
export interface FileCombineResponse {
  success: boolean;
  destination?: string;
  filesCombined: number;
  totalSize?: number;
  sourceFiles?: string[];
}

export function formatFileCombine(response: FileCombineResponse): string {
  const lines: string[] = [];

  const icon = response.success ? '✓' : '✗';

  lines.push(header(1, `${icon} Combined: ${response.destination}`));
  lines.push('');

  if (response.success) {
    lines.push(property('Destination', response.destination ?? '(none)', 0));
    lines.push(property('Files combined', response.filesCombined.toString(), 0));
    if (response.totalSize !== undefined) {
      lines.push(property('Total size', formatFileSize(response.totalSize), 0));
    }
    lines.push('');

    if (response.sourceFiles && response.sourceFiles.length > 0) {
      lines.push(header(2, 'Source Files'));
      response.sourceFiles.slice(0, 10).forEach(file => {
        const name = file.split('/').pop() || file;
        lines.push(`- ${name}`);
      });
      if (response.sourceFiles.length > 10) {
        lines.push(`- ... and ${response.sourceFiles.length - 10} more`);
      }
    }
  } else {
    lines.push('Failed to combine files.');
  }

  lines.push('');
  lines.push(divider());
  lines.push(tip('Use `view.read(path)` to view the combined file'));
  lines.push(summaryFooter());

  return joinLines(lines);
}
