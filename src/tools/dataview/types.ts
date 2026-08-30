/**
 * Dataview plugin API type definitions (not provided by Dataview's package)
 * These model the runtime API surface used by this tool.
 */

/** Dataview's array-like collection with .array() accessor */
export interface DataviewArray<T = unknown> {
  length: number;
  array(): T[];
  slice(start?: number, end?: number): DataviewArray<T>;
  map<U>(fn: (item: T) => U): DataviewArray<U>;
}

/**
 * Dataview date/time value. Dataview emits Luxon DateTime objects, which
 * expose `toISO()` (returns `string | null`). Some test fixtures pass native
 * `Date` objects that only expose `toISOString()`. We accept either shape.
 */
export interface DataviewDateTime {
  toISO?(): string | null;
  toISOString?(): string;
}

/** Dataview link value */
export interface DataviewLink {
  path: string;
  display: string;
}

/** Dataview file metadata on a page object */
export interface DataviewFileInfo {
  path: string;
  name: string;
  basename?: string;
  extension?: string;
  size: number;
  ctime?: DataviewDateTime;
  mtime?: DataviewDateTime;
  tags?: DataviewArray<string>;
  outlinks?: DataviewArray<DataviewLink>;
  inlinks?: DataviewArray<DataviewLink>;
  tasks?: DataviewArray<DataviewTask>;
  lists?: DataviewArray<unknown>;
}

/** Dataview task item */
export interface DataviewTask {
  text: string;
  completed: boolean;
  line: number;
  path: string;
}

/** A Dataview page object (file + frontmatter fields) */
export interface DataviewPage {
  file: DataviewFileInfo;
  aliases?: DataviewArray<string>;
  [key: string]: unknown;
}

/**
 * Query result from `dataviewAPI.query()`.
 *
 * Dataview resolves `query()` to a `Result` monad — `{ successful, value, error }`
 * — NOT a flat `{ type, values }` object. The actual query payload (type /
 * values / headers) lives under `.value`, and `value.values` is a *plain*
 * array (`Literal[]` / `Literal[][]`), not a wrapped `DataArray` with `.array()`.
 * Modelling this faithfully is what fixes #216: reading `result.type` /
 * `result.values` directly yields `undefined`, collapsing every query to the
 * `unknown`/"No results found" branch.
 */
export interface DataviewQueryResult {
  successful?: boolean;
  value?: {
    type: string;
    values?: unknown;
    headers?: string[];
  };
  error?: string;
}

/** Row within a table result */
export interface DataviewTableRow {
  array(): unknown[];
}

/** The Dataview plugin API surface we consume */
export interface DataviewAPI {
  query(dql: string): Promise<DataviewQueryResult>;
  pages(source?: string): DataviewArray<DataviewPage>;
  page(path: string): DataviewPage | null;
}

/** Workflow suggestion shape */
export interface WorkflowSuggestion {
  description: string;
  command: string;
  reason: string;
}

/** Workflow response */
export interface WorkflowResponse {
  message: string;
  suggested_next: WorkflowSuggestion[];
}

/** Query hints response */
export interface QueryHintsResponse {
  performance: string[];
  syntax: string[];
  data: string[];
  alternatives: string[];
}

/** Formatted query result */
export interface FormattedQueryResult {
  type: string;
  values?: unknown[];
  headers?: string[];
  data?: DataviewQueryResult;
}
