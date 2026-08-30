/**
 * Dataview operation formatters
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
 * Format dataview.query response
 */
export interface DataviewQueryResponse {
  query: string;
  type: 'list' | 'table' | 'task' | 'calendar';
  values?: DataviewValue[];
  headers?: string[];
  successful: boolean;
  error?: string;
}

type DataviewValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function formatDataviewQuery(response: DataviewQueryResponse): string {
  const lines: string[] = [];

  lines.push(header(1, `Dataview: ${response.type.toUpperCase()}`));
  lines.push('');
  lines.push(property('Query', truncate(response.query, 80), 0));
  lines.push('');

  if (!response.successful) {
    lines.push(`❌ Query failed: ${response.error || 'Unknown error'}`);
    lines.push('');
    lines.push(tip('Use `dataview.validate(query)` to check query syntax'));
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  if (!response.values || response.values.length === 0) {
    lines.push('No results found.');
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  // Format based on type
  if (response.type === 'table' && response.headers) {
    lines.push(formatDataviewTable(response.headers, response.values));
  } else if (response.type === 'list') {
    lines.push(formatDataviewList(response.values));
  } else if (response.type === 'task') {
    lines.push(formatDataviewTasks(response.values));
  } else {
    // Fallback for calendar or unknown
    lines.push(`${response.values.length} results returned`);
  }

  lines.push(divider());
  lines.push(tip('Use `view.read(path)` to examine any result'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Render a single table cell value. Dataview hands back rich objects — `Link`
 * (`{ path, display }`) and Luxon `DateTime` (`toISO()`) — not primitives.
 * Without coercion they dumped as raw JSON (`{"path":…}`) and quoted ISO
 * strings (#220). Collapse a Link to its display/path, a DateTime to ISO, and
 * leave primitives as-is.
 */
function coerceCell(val: unknown): string {
  if (val === null || val === undefined) {
    return '';
  }
  if (typeof val === 'string') {
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return String(val);
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.path === 'string') {
      return typeof obj.display === 'string' && obj.display ? obj.display : obj.path;
    }
    if (typeof obj.toISO === 'function') {
      const iso = (obj.toISO as () => unknown)();
      if (typeof iso === 'string' && iso) return iso;
    }
    if (val instanceof Date) {
      return val.toISOString();
    }
    return JSON.stringify(val);
  }
  return JSON.stringify(val);
}

function formatDataviewTable(headers: string[], rows: DataviewValue[]): string {
  const lines: string[] = [];

  // Limit columns for readability
  const displayHeaders = headers.slice(0, 6);
  const hasMore = headers.length > 6;

  // Header row
  lines.push('| ' + displayHeaders.join(' | ') + (hasMore ? ' | ...' : '') + ' |');
  lines.push('| ' + displayHeaders.map(() => '---').join(' | ') + (hasMore ? ' | ---' : '') + ' |');

  // Data rows (limit to 20)
  rows.slice(0, 20).forEach(row => {
    const cells = displayHeaders.map((_, i) => {
      let val: unknown;
      if (Array.isArray(row)) {
        val = row[i];
      } else if (row !== null && typeof row === 'object') {
        val = row[headers[i]];
      }
      return truncate(coerceCell(val), 30);
    });
    lines.push('| ' + cells.join(' | ') + (hasMore ? ' | ...' : '') + ' |');
  });

  if (rows.length > 20) {
    lines.push(`\n... and ${rows.length - 20} more rows`);
  }

  return lines.join('\n');
}

/** A GROUP BY result element. Dataview wraps each group as a list-pair
 *  (`{ $widget: 'dataview:list-pair', key, value }` for LIST) or `{ key, rows }`
 *  for table-style groups. Without unwrapping, the row formatters rendered the
 *  wrapper object itself instead of its members (#220). */
interface DataviewGroup {
  key: unknown;
  rows: DataviewValue[];
}

function asGroup(item: DataviewValue): DataviewGroup | null {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }
  const obj = item;
  if (!('key' in obj || obj.$widget === 'dataview:list-pair')) {
    return null;
  }
  const inner = obj.rows ?? obj.value;
  // The producer (`unwrapGroup`) normally flattens the inner DataArray to a
  // plain array before a group reaches here. Accept a raw DataArray (`.array()`)
  // too, so the formatter stays in agreement with the producer's group
  // predicate rather than silently leaking a wrapper if an unflattened group
  // ever reaches it (PR #249 review, F2).
  if (Array.isArray(inner)) {
    return { key: obj.key, rows: inner as DataviewValue[] };
  }
  if (inner && typeof (inner as { array?: () => unknown[] }).array === 'function') {
    return { key: obj.key, rows: (inner as { array: () => DataviewValue[] }).array() };
  }
  return null;
}

function groupKeyLabel(key: unknown): string {
  // Empty or whitespace-only keys (e.g. `TASK ... GROUP BY status` puts
  // incomplete tasks under the space-character status) render as an empty bold
  // header otherwise. Collapse them to a stable label.
  if (key === null || key === undefined || (typeof key === 'string' && key.trim() === '')) {
    return '(no group)';
  }
  if (typeof key === 'string') {
    return key;
  }
  if (typeof key === 'number' || typeof key === 'bigint' || typeof key === 'boolean') {
    return String(key);
  }
  if (typeof key === 'object') {
    const obj = key as Record<string, unknown>;
    const filePath = obj.path ?? (obj.file as Record<string, unknown> | undefined)?.path;
    return typeof filePath === 'string' ? filePath : JSON.stringify(key);
  }
  return JSON.stringify(key);
}

function renderListItem(item: DataviewValue): string {
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const filePath = obj.path ?? (obj.file as Record<string, unknown> | undefined)?.path;
    return typeof filePath === 'string' ? filePath : JSON.stringify(item);
  }
  return String(item);
}

function formatDataviewList(items: DataviewValue[]): string {
  // GROUP BY: elements arrive as list-pair group wrappers — render each group's
  // key and its rows, not the wrapper object (#220). Switch to grouped
  // rendering if *any* element is a group (not all), and render a stray
  // non-group element as a plain top-level row, so one unrecognized group can't
  // collapse the whole result back to raw wrappers (PR #249 review, F1).
  const groups = items.map(asGroup);
  if (items.length > 0 && groups.some(g => g !== null)) {
    const lines: string[] = [];
    items.slice(0, 20).forEach((item, i) => {
      const group = groups[i];
      if (group) {
        lines.push(`**${truncate(groupKeyLabel(group.key), 60)}** (${group.rows.length})`);
        group.rows.slice(0, 30).forEach(row => {
          lines.push(`- ${truncate(renderListItem(row), 60)}`);
        });
        if (group.rows.length > 30) {
          lines.push(`  ... and ${group.rows.length - 30} more`);
        }
      } else {
        lines.push(`- ${truncate(renderListItem(item), 60)}`);
      }
      lines.push('');
    });
    if (items.length > 20) {
      lines.push(`... and ${items.length - 20} more groups`);
    }
    return lines.join('\n').trimEnd();
  }

  const lines: string[] = [];

  items.slice(0, 30).forEach((item, i) => {
    lines.push(`${i + 1}. ${truncate(renderListItem(item), 60)}`);
  });

  if (items.length > 30) {
    lines.push(`\n... and ${items.length - 30} more items`);
  }

  return lines.join('\n');
}

interface DataviewTask {
  completed?: boolean;
  text?: string;
  task?: string;
  path?: string;
}

function renderTask(taskItem: DataviewValue): string {
  const task = (taskItem !== null && typeof taskItem === 'object' && !Array.isArray(taskItem)
    ? taskItem
    : {}) as DataviewTask;
  const checkbox = task.completed ? '[x]' : '[ ]';
  const taskString = taskItem !== null && typeof taskItem === 'object'
    ? JSON.stringify(taskItem)
    : String(taskItem);
  const text = task.text || task.task || taskString;
  let line = `- ${checkbox} ${truncate(text, 60)}`;
  if (task.path) {
    line += `\n      from: ${task.path}`;
  }
  return line;
}

function formatDataviewTasks(tasks: DataviewValue[]): string {
  // GROUP BY: elements arrive as group wrappers — render each group's key then
  // its tasks (#220). Switch to grouped rendering if *any* element is a group
  // (not all), and render a stray non-group element as a plain task, so one
  // unrecognized group can't collapse the whole result (PR #249 review, F1).
  const groups = tasks.map(asGroup);
  if (tasks.length > 0 && groups.some(g => g !== null)) {
    const lines: string[] = [];
    tasks.slice(0, 20).forEach((taskItem, i) => {
      const group = groups[i];
      if (group) {
        lines.push(`**${truncate(groupKeyLabel(group.key), 60)}** (${group.rows.length})`);
        group.rows.slice(0, 30).forEach(row => lines.push(renderTask(row)));
        if (group.rows.length > 30) {
          lines.push(`  ... and ${group.rows.length - 30} more`);
        }
      } else {
        lines.push(renderTask(taskItem));
      }
      lines.push('');
    });
    if (tasks.length > 20) {
      lines.push(`... and ${tasks.length - 20} more groups`);
    }
    return lines.join('\n').trimEnd();
  }

  const lines: string[] = [];

  tasks.slice(0, 30).forEach(taskItem => {
    lines.push(renderTask(taskItem));
  });

  if (tasks.length > 30) {
    lines.push(`\n... and ${tasks.length - 30} more tasks`);
  }

  return lines.join('\n');
}

/**
 * Format dataview.status response
 */
export interface DataviewStatusResponse {
  available: boolean;
  version?: string;
}

export function formatDataviewStatus(response: DataviewStatusResponse): string {
  const lines: string[] = [];

  lines.push(header(1, 'Dataview Status'));
  lines.push('');

  if (response.available) {
    lines.push('✓ Dataview plugin is available');
    if (response.version) {
      lines.push(property('Version', response.version, 0));
    }
  } else {
    lines.push('✗ Dataview plugin is not available');
    lines.push('');
    lines.push(tip('Install the Dataview plugin from Obsidian Community Plugins'));
  }

  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format dataview.list response
 *
 * `listPages()` returns `{ success, source, count, pages: [...] }`, not the
 * `{ values }` shape `formatDataviewQuery` reads — routing it through the query
 * formatter always hit the `!values` branch and rendered "No results found"
 * regardless of data (#220). A page list isn't really a query result, so it
 * gets its own formatter.
 */
export interface DataviewPagesResponse {
  success: boolean;
  source?: string;
  count?: number;
  pages?: Array<Record<string, unknown>>;
  error?: string;
}

export function formatDataviewPages(response: DataviewPagesResponse): string {
  const lines: string[] = [];

  lines.push(header(1, 'Dataview: Pages'));
  lines.push('');
  lines.push(property('Source', response.source ?? 'all', 0));

  if (response.success === false) {
    lines.push('');
    lines.push(`❌ Query failed: ${response.error || 'Unknown error'}`);
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  const pages = response.pages ?? [];
  const total = response.count ?? pages.length;
  lines.push(property('Count', String(total), 0));
  lines.push('');

  if (pages.length === 0) {
    lines.push('No pages found.');
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  pages.slice(0, 30).forEach((page, i) => {
    const path = typeof page.path === 'string' ? page.path : JSON.stringify(page);
    lines.push(`${i + 1}. ${truncate(path, 60)}`);
  });

  if (total > 30) {
    lines.push(`\n... and ${total - 30} more pages`);
  }

  lines.push(divider());
  lines.push(tip('Use `dataview.metadata(path)` for one page, or `view.read(path)` to open it'));
  lines.push(summaryFooter());

  return joinLines(lines);
}

/**
 * Format dataview.metadata response
 *
 * `getPageMetadata()` returns `{ success, path, metadata: {...} }` — same #220
 * shape mismatch as the page list. A single page's metadata is not a query
 * result either, so it gets a dedicated formatter rather than the `{ values }`
 * query path.
 */
export interface DataviewMetadataResponse {
  success: boolean;
  path: string;
  metadata?: {
    file?: Record<string, unknown>;
    tags?: unknown[];
    aliases?: unknown[];
    outlinks?: unknown[];
    inlinks?: unknown[];
    tasks?: number;
    lists?: number;
    custom?: Record<string, unknown>;
  };
  error?: string;
}

export function formatDataviewMetadata(response: DataviewMetadataResponse): string {
  const lines: string[] = [];

  lines.push(header(1, 'Dataview: Metadata'));
  lines.push('');
  lines.push(property('Path', response.path, 0));

  if (response.success === false || !response.metadata) {
    lines.push('');
    lines.push(`❌ ${response.error || 'No metadata available'}`);
    lines.push(summaryFooter());
    return joinLines(lines);
  }

  const m = response.metadata;
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const aliases = Array.isArray(m.aliases) ? m.aliases : [];
  const outlinks = Array.isArray(m.outlinks) ? m.outlinks : [];
  const inlinks = Array.isArray(m.inlinks) ? m.inlinks : [];

  lines.push('');
  if (tags.length > 0) {
    lines.push(property('Tags', tags.map(t => String(t)).join(', '), 0));
  }
  if (aliases.length > 0) {
    lines.push(property('Aliases', aliases.map(a => String(a)).join(', '), 0));
  }
  lines.push(property('Outlinks', String(outlinks.length), 0));
  lines.push(property('Inlinks', String(inlinks.length), 0));
  lines.push(property('Tasks', String(m.tasks ?? 0), 0));
  lines.push(property('Lists', String(m.lists ?? 0), 0));

  const custom = (m.custom && typeof m.custom === 'object') ? m.custom : {};
  const customKeys = Object.keys(custom);
  if (customKeys.length > 0) {
    lines.push('');
    lines.push(header(2, 'Frontmatter'));
    customKeys.slice(0, 15).forEach(key => {
      const value = custom[key];
      let display: string;
      if (value === null || value === undefined) {
        display = String(value);
      } else if (typeof value === 'object') {
        display = JSON.stringify(value);
      } else {
        const primitive = value as string | number | boolean | bigint | symbol;
        display = String(primitive);
      }
      lines.push(property(key, truncate(display, 50), 0));
    });
    if (customKeys.length > 15) {
      lines.push(`... and ${customKeys.length - 15} more fields`);
    }
  }

  lines.push(divider());
  lines.push(tip('Use `view.read(path)` to view the full note'));
  lines.push(summaryFooter());

  return joinLines(lines);
}
