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

/** The surface of one tool: its declaration and its execution handler. */
export interface OperationDefinition {
  name: string;
  /** Human-readable display name (MCP Tool.title, spec 2026-07-28). */
  title: string;
  description: string;
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
