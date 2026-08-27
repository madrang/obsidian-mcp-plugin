/**
 * Shared types and param helpers for the operation modules
 * (extracted from router.ts — ADR-202).
 */

/** Type alias for operation parameters passed through the router */
export type Params = Record<string, unknown>;

/** Search result item from vault search */
export interface SearchResultItem {
  path: string;
  title?: string;
  score?: number;
  type?: string;
  context?: string;
}

/** Helper to safely extract a string from params */
export function paramStr(params: Params, key: string): string | undefined {
  const val = params[key];
  return typeof val === 'string' ? val : undefined;
}

/** Helper to safely extract a number from params */
export function paramNum(params: Params, key: string): number | undefined {
  const val = params[key];
  return typeof val === 'number' ? val : undefined;
}

/** Helper to safely extract a boolean from params */
export function paramBool(params: Params, key: string): boolean | undefined {
  const val = params[key];
  return typeof val === 'boolean' ? val : undefined;
}

/**
 * Read and validate the pagination params shared by the list actions.
 * `pageSize` is the page content text size in characters, `limit` the item
 * count cap. A present but invalid value fails closed: asking for less than
 * one item or an invalid page size is a caller error, never a silent default.
 */
export function readPageArgs(params: Params, caller: string): { page?: number; pageSize?: number; limit?: number } {
  const page = paramNum(params, 'page');
  const pageSize = paramNum(params, 'pageSize');
  const limit = paramNum(params, 'limit');
  if ('pageSize' in params && pageSize === undefined) {
    throw new Error(`${caller}: 'pageSize' must be a number of at least 1 (characters).`);
  }
  if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) {
    throw new Error(`${caller}: 'pageSize' must be a whole number of at least 1 (characters).`);
  }
  if ('limit' in params && limit === undefined) {
    throw new Error(`${caller}: 'limit' must be a number of at least 1.`);
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`${caller}: 'limit' must be a whole number of at least 1.`);
  }
  if ('page' in params && page === undefined) {
    throw new Error(`${caller}: 'page' must be a number of at least 1.`);
  }
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
    throw new Error(`${caller}: 'page' must be a whole number of at least 1.`);
  }
  return { page, pageSize, limit };
}

/**
 * Require a string param at the MCP dispatch boundary.
 *
 * Throws before any vault call when the param is missing or wrong-typed,
 * so a malformed client call cannot reach a sink like `vault.modify` with
 * `String(undefined) === "undefined"` and corrupt the file (#210). `hint`
 * is appended to the message when set — use it to point callers at the
 * right tool/shape when a known misuse is likely.
 */
export function requireParamStr(
  params: Params,
  key: string,
  action: string,
  hint?: string,
): string {
  const val = params[key];
  if (typeof val !== 'string') {
    const have = val === undefined ? 'missing' : `got ${typeof val}`;
    const base = `${action} requires '${key}' (string, ${have}).`;
    throw new Error(hint ? `${base} ${hint}` : base);
  }
  return val;
}
