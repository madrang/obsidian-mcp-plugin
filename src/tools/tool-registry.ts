/**
 * Registry for the per-tool surface definitions.
 *
 * Each module in ./definitions declares one tool of the MCP surface (its
 * description, actions, annotations, and parameter schema) and registers it
 * here at import time. The registry lives apart from semantic-tools.ts so a
 * definition module never imports the factory it registers into. That cycle
 * would run registerOperation before the registry exists.
 */

import type { RouterContext } from '../semantic/operations/router-context';
import type { Params } from '../semantic/operations/shared';

/** MCP ToolAnnotations (spec 2026-07-28): behavior hints, not guarantees */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** The execution half of a tool: what SemanticRouter.executeOperation calls. */
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
export type DescriptionLine = string | { when: string | string[]; text: string };

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
      const keys = Array.isArray(line.when) ? line.when : [line.when];
      return keys.every(key => visible.has(key));
    })
    .map(line => (typeof line === 'string' ? line : line.text))
    .join('\n');
}

/** The surface of one tool: its declaration and its execution handler. */
export interface OperationDefinition {
  name: string;
  /** Human-readable display name (MCP Tool.title, spec 2026-07-28). */
  title: string;
  /**
   * The description as an array of markdown-shaped lines. The factory joins
   * the lines the session can see on '\n' (buildDescription). The first
   * static line starts with the tool emoji — the settings UI strips it.
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
    type: 'string',
    description: 'The file path relative to the vault root'
  }
};

export const contentParam = {
  content: {
    type: 'string',
    description: 'The text content to write (markdown supported)'
  }
};
