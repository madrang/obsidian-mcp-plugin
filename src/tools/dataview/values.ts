/**
 * Dataview value coercion: the plugin hands back Luxon dates, wrapped
 * DataArray collections, and link objects. These helpers flatten them to
 * plain JavaScript values for the MCP response.
 */
import { DataviewDateTime, DataviewPage, DataviewAPI } from './types';

/**
 * Serialize a Dataview date value to ISO 8601, preferring Luxon's `toISO()`
 * and falling back to native `Date.toISOString()`. Returns `undefined` for
 * nullish input, invalid Luxon dates, or values that expose neither method —
 * which lets `?.` propagate cleanly and keeps the response shape stable.
 */
export function toIsoOptional(value: unknown): string | undefined {
  if (value == null) return undefined;
  const dt = value as DataviewDateTime;
  if (typeof dt.toISO === 'function') {
    const iso = dt.toISO();
    if (iso) return iso;
  }
  if (typeof dt.toISOString === 'function') {
    return dt.toISOString();
  }
  return undefined;
}

/**
 * Coerce a Dataview `values` field to a plain array.
 *
 * Dataview's `query()` returns plain arrays (`Literal[]` / `Literal[][]`), but
 * other API surfaces (`pages()`, `page().file.*`) hand back wrapped `DataArray`
 * collections that expose `.array()`. Accepting either keeps the query path
 * correct while staying defensive against version drift.
 */
export function toPlainArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const wrapped = value as { array?: () => unknown[] } | null | undefined;
  if (wrapped && typeof wrapped.array === 'function') return wrapped.array();
  return [];
}

/**
 * GROUP BY results nest rows under a group wrapper — `{ key, rows }`, or a
 * list-pair `{ $widget: 'dataview:list-pair', key, value }` for LIST. The inner
 * collection may itself be a Dataview DataArray, so it's run through
 * toPlainArray. Returns null when the element is a plain row, not a group.
 */
export function unwrapGroup(el: unknown): { key: unknown; rows: unknown[] } | null {
  if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
  const obj = el as Record<string, unknown>;
  const inner = obj.rows ?? obj.value;
  const isGroup = 'key' in obj || obj.$widget === 'dataview:list-pair';
  if (!isGroup) return null;
  if (!Array.isArray(inner) && !(inner && typeof (inner as { array?: () => unknown[] }).array === 'function')) {
    return null;
  }
  return { key: obj.key, rows: toPlainArray(inner) };
}

/**
 * Safely cast the detector's unknown API to our typed interface.
 * The Dataview API is a runtime dependency without published types,
 * so we use this helper to bridge the gap.
 */
export function asDataviewAPI(api: unknown): DataviewAPI {
  return api as DataviewAPI;
}

/**
 * Convert Dataview values to plain JavaScript values
 */
export function convertDataviewValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Dataview arrays
  const dvArray = value as { array?: () => unknown[] };
  if (typeof dvArray.array === 'function') {
    return dvArray.array().map((item: unknown) => convertDataviewValue(item));
  }

  // Handle Dataview dates (Luxon DateTime exposes toISO(), native Date toISOString())
  const dvDate = value as DataviewDateTime;
  if (typeof dvDate.toISO === 'function' || typeof dvDate.toISOString === 'function') {
    const iso = toIsoOptional(value);
    if (iso !== undefined) return iso;
  }

  // Handle Dataview links
  const dvLink = value as { path?: string; display?: string };
  if (dvLink.path && dvLink.display) {
    return {
      path: dvLink.path
      , display: dvLink.display
    };
  }

  return value;
}

/**
 * Extract custom frontmatter fields from a page
 */
export function extractCustomFields(page: DataviewPage): Record<string, unknown> {
  const customFields: Record<string, unknown> = {};

  // Standard fields to exclude
  const excludeFields = new Set([
    'file', 'tags', 'aliases', 'outlinks', 'inlinks', 'tasks', 'lists'
  ]);

  // Extract all non-standard fields
  for (const [key, value] of Object.entries(page as Record<string, unknown>)) {
    if (!excludeFields.has(key) && !key.startsWith('$')) {
      // Convert Dataview values to plain JavaScript values
      customFields[key] = convertDataviewValue(value);
    }
  }

  return customFields;
}
