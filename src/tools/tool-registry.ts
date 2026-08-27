/**
 * Registry for the per-tool surface definitions.
 *
 * Each module in ./definitions declares one tool of the MCP surface (its
 * description, actions, annotations, and parameter schema) and registers it
 * here at import time. The registry lives apart from tool-factory.ts so a
 * definition module never imports the factory it registers into. That cycle
 * would run registerOperation before the registry exists.
 */

import type { RouterContext } from './operations/router-context';
import type { Params } from './operations/shared';

/** MCP ToolAnnotations (spec 2026-07-28): behavior hints, not guarantees */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** The execution half of a tool: what VaultRouter.executeOperation calls. */
export type OperationHandler = (
  ctx: RouterContext,
  action: string,
  params: Params
) => Promise<unknown>;

/**
 * One line of a tool description. A plain string always ships. A
 * conditional line ships only when every key in `when` is on the session's
 * surface: `'op'`, `'op.action'`, or `'gate:overwrite'` / `'gate:webFetch'`.
 * A hidden action leaves the description in the same pass it leaves the
 * schema, so the prose can never advertise what the enum omits.
 */
export type DescriptionLine = string | {
  when?: string | string[];
  /** Show the line only when none of these keys are visible. The inverse of
   *  `when`: it expresses a variant for a gate that is off without letting an
   *  unconditional line leak through on top of the gate-on variant. */
  whenNot?: string | string[];
  text: string;
};

/**
 * Build the description for one session from its surface-key set: the
 * operation, its visible actions as `op.action` keys, and the gates that are
 * on. The same key set is what a future system.permissions reports, so one
 * resolver drives both consumers.
 */
export function buildDescription(lines: DescriptionLine[], visible: ReadonlySet<string>): string {
  return lines
    .filter(line => {
      if (typeof line === 'string') return true;
      const keys = line.when === undefined ? [] : (Array.isArray(line.when) ? line.when : [line.when]);
      if (!keys.every(key => visible.has(key))) return false;
      const notKeys = line.whenNot === undefined ? [] : (Array.isArray(line.whenNot) ? line.whenNot : [line.whenNot]);
      return notKeys.every(key => !visible.has(key));
    })
    .map(line => (typeof line === 'string' ? line : line.text))
    .join('\n');
}

/**
 * The conditional lines that belong to one action: every line whose `when`
 * names `op.action`, alone or inside a multi-key conjunction. A companion
 * key that is not the action (a gate) must also pass `visible` when a set is
 * given — the settings UI passes the live gate state so the overwrite
 * sentence stays off the create row while the gate is off.
 */
export function getActionDescriptionLines(
  operation: string,
  action: string,
  visible?: ReadonlySet<string>
): string[] {
  const definition = getOperationDefinition(operation);
  if (!definition) return [];
  const actionKey = `${operation}.${action}`;
  const out: string[] = [];
  for (const line of definition.descriptionLines) {
    if (typeof line === 'string') continue;
    const keys = line.when === undefined ? [] : (Array.isArray(line.when) ? line.when : [line.when]);
    if (!keys.includes(actionKey)) continue;
    if (visible && !keys.every(key => key === actionKey || visible.has(key))) continue;
    const notKeys = line.whenNot === undefined ? [] : (Array.isArray(line.whenNot) ? line.whenNot : [line.whenNot]);
    if (visible && notKeys.some(key => visible.has(key))) continue;
    out.push(line.text);
  }
  return out;
}

/**
 * The static lines only — the tool-level text with every conditional
 * (action-owned) line removed. Headings left with no content drop out too,
 * so a section that consisted entirely of action bullets disappears instead
 * of lingering as an empty title.
 */
export function getStaticDescriptionLines(operation: string): string[] {
  const definition = getOperationDefinition(operation);
  const staticLines = (definition?.descriptionLines ?? []).filter(
    (line): line is string => typeof line === 'string'
  );
  const out: string[] = [];
  let pendingHeading: string | null = null;
  for (const line of staticLines) {
    if (line.startsWith('#')) {
      pendingHeading = line;
      continue;
    }
    if (pendingHeading !== null) {
      if (line.trim() !== '') {
        out.push(pendingHeading, line);
        pendingHeading = null;
      }
      continue;
    }
    out.push(line);
  }
  return out;
}

/** The surface of one tool: its declaration and its execution handler. */
export interface OperationDefinition {
  name: string;
  /** Human-readable display name (MCP Tool.title, spec 2026-07-28). */
  title: string;
  /**
   * The description as an array of markdown-shaped lines. The factory joins
   * the lines the session can see on '\n' (buildDescription).
   */
  descriptionLines: DescriptionLine[];
  actions: string[];
  /**
   * Required parameters per action, for actions that have any. Emitted into
   * the input schema as allOf/if/then conditionals and enforced at dispatch
   * with a MISSING_PARAMETER error — one map drives both, so they cannot
   * drift. Only list what the handler unconditionally needs; parameters with
   * a fallback (for example at_line's buffered content) stay optional.
   */
  requiredParams?: Record<string, string[]>;
  /**
   * One-of requirements per action: the call must carry at least one of the
   * listed parameters. Emitted into the input schema as an anyOf conditional
   * and enforced at dispatch with a MISSING_PARAMETER error, mirroring
   * requiredParams.
   */
  requireAnyParams?: Record<string, string[]>;
  annotations?: ToolAnnotations;
  parameters: Record<string, unknown>;
  execute: OperationHandler;
}

const registry = new Map<string, OperationDefinition>();

export function registerOperation(definition: OperationDefinition): void {
  if (registry.has(definition.name)) {
    throw new Error(`Duplicate operation registration: ${definition.name}`);
  }
  registry.set(definition.name, definition);
}

export function getOperationDefinition(name: string): OperationDefinition | undefined {
  return registry.get(name);
}

/** All registered operations, in registration order. */
export function getRegisteredOperations(): OperationDefinition[] {
  return [...registry.values()];
}

/** Shared schema fragments for the definition modules. */
export const pathParam = {
  path: {
    type: 'string'
    , description: 'The file path relative to the vault root'
  }
};

export const contentParam = {
  content: {
    type: 'string'
    , description: 'The text content to write (markdown supported)'
  }
};
