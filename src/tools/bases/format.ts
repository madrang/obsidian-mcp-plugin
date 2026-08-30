/**
 * Bases operation formatters
 */

import {
  header,
  property,
  truncate,
  divider,
  tip,
  summaryFooter,
  joinLines
} from '../format-utils';

/**
 * Format bases.query response. queryBase returns { notes, total } — one
 * EvaluatedNote per row, with evaluated properties. The base path is not
 * part of the result, so the header names the result set, not the file.
 */
export interface BasesQueryResponse {
  notes: Array<{
    path: string;
    name: string;
    properties?: Record<string, unknown>;
  }>;
  total: number;
}

export function formatBasesQuery(response: BasesQueryResponse): string {
  const lines: string[] = [];

  lines.push(header(1, 'Base Results'));
  lines.push('');
  lines.push(property('Results', response.total.toString(), 0));
  lines.push('');

  if (response.notes.length === 0) {
    lines.push('No matching entries found.');
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  // Format as simple list
  response.notes.slice(0, 20).forEach((note, i) => {
    const title = note.name || note.path || `Entry ${i + 1}`;
    lines.push(`${i + 1}. **${title}**`);
    lines.push(`   ${note.path}`);

    // Show a few properties
    const props = Object.keys(note.properties ?? {})
      .filter(k => !['name', 'path'].includes(k))
      .slice(0, 3);
    props.forEach(prop => {
      lines.push(property(prop, truncate(String(note.properties?.[prop]), 40), 1));
    });
    lines.push('');
  });

  if (response.notes.length > 20) {
    lines.push(`... and ${response.notes.length - 20} more entries`);
  }

  lines.push(divider());
  lines.push(tip('Use filters to narrow down results'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format bases.list response
 */
export interface BasesListEntry {
  path: string;
  name: string;
  views: string[];
}

export interface BasesListResponse {
  bases: Array<string | BasesListEntry>;
  count?: number;
}

export function formatBasesList(response: BasesListResponse | Array<string | BasesListEntry>): string {
  const lines: string[] = [];

  // Handle both array and object response. listBases() returns entry
  // objects; callers built before that change may still hand over paths.
  const bases = Array.isArray(response) ? response : response.bases;
  const count = Array.isArray(response) ? response.length : (response.count ?? response.bases.length);

  lines.push(header(1, 'Available Bases'));
  lines.push('');
  lines.push(`Found ${count} base file${count !== 1 ? 's' : ''}`);
  lines.push('');

  if (bases.length === 0) {
    lines.push('No .base files found in vault.');
    lines.push('');
    lines.push(tip('Create a .base file to define a structured database'));
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  bases.slice(0, 30).forEach((base, i) => {
    const path = typeof base === 'string' ? base : base.path;
    const name = typeof base === 'string'
      ? (base.split('/').pop() || base)
      : (base.name || base.path.split('/').pop() || base.path);
    lines.push(`${i + 1}. ${name}`);
    lines.push(`   ${path}`);
  });

  if (bases.length > 30) {
    lines.push(`\n... and ${bases.length - 30} more`);
  }

  lines.push('');
  lines.push(divider());
  lines.push(tip('Use `bases.read(path)` to view a base configuration'));
  lines.push(tip('Use `bases.query(path)` to query data from a base'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format bases.read response. readBase returns the parsed BaseYAML
 * configuration itself — filters, formulas, properties, views. The path is
 * not part of the result, so the header stays generic.
 */
export interface BasesReadResponse {
  filters?: string | Record<string, unknown>;
  formulas?: Record<string, string>;
  properties?: Record<string, { displayName?: string }>;
  views?: Array<{ type?: string; name?: string }>;
}

export function formatBasesRead(response: BasesReadResponse): string {
  const lines: string[] = [];

  lines.push(header(1, 'Base Configuration'));
  lines.push('');

  if (response.filters !== undefined) {
    const filters = typeof response.filters === 'string'
      ? response.filters
      : JSON.stringify(response.filters);
    lines.push(property('Filters', truncate(filters, 60), 0));
  }

  if (response.formulas && Object.keys(response.formulas).length > 0) {
    lines.push(property('Formulas', Object.keys(response.formulas).join(', '), 0));
  }
  lines.push('');

  // Property display configurations: keys with an optional display name
  if (response.properties && Object.keys(response.properties).length > 0) {
    lines.push(header(2, 'Properties'));
    const keys = Object.keys(response.properties);
    keys.slice(0, 10).forEach(key => {
      const display = response.properties?.[key]?.displayName;
      lines.push(`- ${key}${display && display !== key ? ` (${display})` : ''}`);
    });
    if (keys.length > 10) {
      lines.push(`... and ${keys.length - 10} more properties`);
    }
    lines.push('');
  }

  // Views: count plus name and type of each
  if (response.views && response.views.length > 0) {
    lines.push(property('Views', response.views.length.toString(), 0));
    response.views.slice(0, 10).forEach(view => {
      lines.push(`- ${view.name ?? 'unnamed'} (${view.type ?? 'unknown'})`);
    });
  }

  lines.push(divider());
  lines.push(tip('Use `bases.query(path)` to query data from this base'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format bases.create response
 */
export interface BasesCreateResponse {
  success: boolean;
  path: string;
  error?: string;
}

export function formatBasesCreate(response: BasesCreateResponse): string {
  const lines: string[] = [];

  const icon = response.success ? '✓' : '✗';
  lines.push(header(1, `${icon} Created Base`));
  lines.push('');

  if (response.success) {
    lines.push(`Base created successfully.`);
    lines.push('');
    lines.push(property('Path', response.path, 0));
    lines.push('');
    lines.push(tip('Use `bases.read(path)` to view the configuration'));
    lines.push(tip('Use `bases.query(path)` to query data'));
  } else {
    lines.push('Failed to create base.');
    if (response.error) {
      lines.push('');
      lines.push(property('Error', response.error, 0));
    }
  }

  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format bases.export response
 */
export interface BasesExportResponse {
  success: boolean;
  format: 'csv' | 'json' | 'markdown';
  data: string;
  rowCount?: number;
}

export function formatBasesExport(response: BasesExportResponse): string {
  const lines: string[] = [];

  const icon = response.success ? '✓' : '✗';
  lines.push(header(1, `${icon} Exported Base`));
  lines.push('');

  if (response.success) {
    lines.push(property('Format', response.format.toUpperCase(), 0));
    if (response.rowCount !== undefined) {
      lines.push(property('Rows', response.rowCount.toString(), 0));
    }
    lines.push('');

    lines.push(header(2, 'Data'));
    lines.push('');

    // Show preview of data
    const maxLength = 2000;
    if (response.data.length > maxLength) {
      lines.push('```');
      lines.push(response.data.substring(0, maxLength));
      lines.push('```');
      lines.push(`\n... (${response.data.length - maxLength} more characters)`);
    } else {
      lines.push('```');
      lines.push(response.data);
      lines.push('```');
    }
  } else {
    lines.push('Export failed.');
  }

  lines.push(summaryFooter());

  return joinLines(lines);
}
