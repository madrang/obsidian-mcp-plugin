import { Debug } from '../utils/debug';
import { ObsidianAPI } from '../utils/obsidian-api';
import { SemanticRouter } from '../semantic/router';
import { SemanticRequest } from '../types/semantic';
import { ObsidianImageFile } from '../types/obsidian';
import { isDataviewToolAvailable } from './dataview-tool';
import { formatResponse } from '../formatters';
import { getOperationDefinition, getRegisteredOperations, type ToolAnnotations } from './tool-registry';
import type { DataviewResult } from '../semantic/operations/dataview';

export type { ToolAnnotations } from './tool-registry';

/** MCP content item for text responses */
interface MCPTextContent {
  type: 'text';
  text: string;
}

/** MCP content item for image responses */
interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** MCP tool handler result */
interface MCPToolResult {
  content: (MCPTextContent | MCPImageContent)[];
  isError?: boolean;
}

/** JSON Schema property definition */
interface JsonSchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  items?: { type: string };
}

/** Tool arguments passed to handler */
interface ToolArgs {
  action: string;
  raw?: boolean;
  query?: string;
  format?: string;
  source?: string;
  path?: string;
  [key: string]: unknown;
}

/** Semantic tool definition */
export interface SemanticTool {
  name: string;
  title?: string;
  description: string;
  annotations?: ToolAnnotations;
  inputSchema: {
    type: string;
    properties: Record<string, JsonSchemaProperty | { type: string; description: string }>;
    required: string[];
    /** JSON Schema 2020-12 conditionals: per-action required parameters. */
    allOf?: Array<{ if: unknown; then: unknown }>;
  };
  handler: (api: ObsidianAPI, args: unknown) => Promise<MCPToolResult>;
}

/** Tool visibility map — keys are "operation" or "operation.action", values are enabled/disabled */
export type ToolVisibility = Record<string, boolean>;

/** Plugin interface for checking read-only mode */
interface PluginWithSettings {
  settings?: {
    readOnlyMode?: boolean;
    allowCreateOverwrite?: boolean;
  };
}

/**
 * Unified semantic tools: one tool per operation group, actions as an enum
 * parameter. Each tool's static surface (description, actions, annotations,
 * and parameter schema) lives in ./definitions and self-registers into
 * ./tool-registry at import time. This module is the factory: it turns each
 * registered definition into a SemanticTool with the dispatch handler.
 */

const createSemanticTool = (operation: string, visibility?: ToolVisibility, webFetchEnabled?: boolean, allowCreateOverwrite?: boolean): SemanticTool | null => {
  // Check operation-level toggle
  if (visibility && visibility[operation] === false) return null;

  // Filter actions based on visibility
  let actions = getActionsForOperation(operation);
  if (visibility) {
    actions = actions.filter(action => visibility[`${operation}.${action}`] !== false);
    if (actions.length === 0) return null;
  }

  // ADR-109: fetch_web is gated by its dedicated setting, not the visibility
  // tree. Hiding it here is presentation — enforcement is the security-layer
  // URL validator, which reads the setting live on every call.
  //
  // Fail closed on an omitted flag rather than testing `=== false`: a caller
  // that forgets to thread the setting should advertise less, not more. The
  // pool always passes an explicit boolean, so this changes nothing in
  // production — it removes a default-open path before something grows into it.
  if (operation === 'system' && webFetchEnabled !== true) {
    actions = actions.filter(action => action !== 'fetch_web');
    if (actions.length === 0) return null;
  }

  // Keep the advertised description in step with the action list.
  let description = getOperationDescription(operation);
  if (operation === 'system' && !actions.includes('fetch_web')) {
    description = description.replace(/, fetch_web:[^,]*$/, '');
  }
  // Schema and prose must agree: when the overwrite gate is off, the
  // description must not advertise a parameter the schema omits.
  if (operation === 'files' && allowCreateOverwrite !== true) {
    description = description.replace('. Set overwrite=true to replace the whole content of an existing file', '');
  }

  const properties: SemanticTool['inputSchema']['properties'] = {
    action: {
      type: 'string',
      description: 'The specific action to perform',
      enum: actions
    },
    raw: {
      type: 'boolean',
      description: 'Return raw JSON instead of the formatted markdown (use when you need complete metadata or structured data for processing)',
      default: false
    },
    ...getParametersForOperation(operation)
  };

  // ADR-109's pattern, applied to create-overwrite: gated by its dedicated
  // setting, not the visibility tree. Hiding the parameter here is
  // presentation — enforcement is the live settings check in the handler.
  // Fail closed on an omitted flag, same as fetch_web.
  if (operation === 'files' && allowCreateOverwrite !== true) {
    delete properties.overwrite;
  }

  // Per-action required parameters as JSON Schema 2020-12 conditionals
  // (MCP inputSchema defaults to 2020-12). The base required stays
  // ['action']; each advertised action with a required set gets an if/then.
  // Built from the visibility-filtered action list, so a disabled action's
  // conditional drops out with its enum value. Clients whose converters
  // strip conditionals see exactly the flat bag they saw before.
  const requiredParams = getOperationDefinition(operation)?.requiredParams ?? {};
  const allOf = actions
    .filter(action => (requiredParams[action]?.length ?? 0) > 0)
    .map(action => ({
      if: { properties: { action: { const: action } }, required: ['action'] },
      then: { required: requiredParams[action] }
    }));

  return {
  name: operation,
  title: getOperationDefinition(operation)?.title,
  description,
  annotations: getAnnotationsForOperation(operation),
  inputSchema: {
    type: 'object',
    properties,
    required: ['action'],
    ...(allOf.length > 0 ? { allOf } : {})
  },
  handler: async (api: ObsidianAPI, rawArgs: unknown): Promise<MCPToolResult> => {
    const args = (rawArgs ?? {}) as ToolArgs;
    const app = api.getApp();

    // Defense in depth: block actions disabled by visibility even if tool is
    // enumerated.
    //
    // Both the operation-level and action-level toggles are checked here, not
    // just the action-level one. Operation-level used to be enforced ONLY by the
    // tool being absent from the built list — which is enumeration, and
    // enumeration is advisory: the settings UI mutates toolVisibility in place,
    // so switching a whole operation off left every live MCP session with full
    // access to it until eviction or restart. Same staleness class as the
    // read-only bug in ADR-108, in the sibling control.
    if (visibility && (visibility[operation] === false ||
        visibility[`${operation}.${args.action}`] === false)) {
      const operationDisabled = visibility[operation] === false;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: {
              code: 'ACTION_DISABLED',
              message: operationDisabled
                ? `Operation '${operation}' is disabled in tool visibility settings`
                : `Action '${args.action}' is disabled in tool visibility settings`
            }
          }, null, 2)
        }]
      };
    }

    // Dispatch only advertised actions. Checked against the operation's full
    // action list (not the visibility-filtered one) so a disabled action still
    // reports ACTION_DISABLED above rather than reading as unknown.
    if (!getActionsForOperation(operation).includes(args.action)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: {
              code: 'INVALID_ACTION',
              message: `Unknown action '${args.action}' for '${operation}'. Available: ${getActionsForOperation(operation).join(', ')}`
            }
          }, null, 2)
        }],
        isError: true
      };
    }

    // The same requiredParams map the schema conditionals advertise, enforced
    // at dispatch: a client whose converter strips if/then, or a model that
    // ignores the schema, still gets a precise coded error to self-correct
    // from — instead of a handler-specific throw downstream.
    const required = getOperationDefinition(operation)?.requiredParams?.[args.action] ?? [];
    const missing = required.filter(key => {
      const value = args[key];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: {
              code: 'MISSING_PARAMETER',
              message: `Action '${operation}.${args.action}' requires: ${missing.join(', ')}`
            }
          }, null, 2)
        }],
        isError: true
      };
    }

    // Read-only mode is NOT enforced here (ADR-108). It is enforced once, in
    // VaultSecurityManager.validateOperation, which now reads the setting live.
    // This layer previously enforced it too — for `operation === 'vault'` only —
    // and the two disagreed: the live check here blocked vault writes while a
    // security layer holding a stale snapshot let `edit` writes through until the
    // next server restart. The duplicate gate was the defect, so it is gone
    // rather than widened. What remains below is presentation.
    const plugin = (api as unknown as { plugin?: PluginWithSettings }).plugin;

    // Overwrite is gated by a dedicated setting, enforced live: the schema
    // omission above is presentation, and a session built while overwrite was
    // allowed must not keep the capability after the toggle flips off.
    if (operation === 'files' && args.overwrite === true &&
        plugin?.settings?.allowCreateOverwrite !== true) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: {
              code: 'OVERWRITE_DISABLED',
              message: "Overwrite is disabled. Enable 'Allow overwrite' in the files tool options, or use the edit tool for a partial change"
            }
          }, null, 2)
        }],
        isError: true
      };
    }

    // Dataview runs its own handler rather than the router envelope: it
    // returns a DataviewResult with structured errors. The handler is
    // registered like every other operation and called with the router as
    // context.
    const router = new SemanticRouter(api, app);

    // Handle Dataview operations separately
    if (operation === 'dataview') {
      const dataviewDefinition = getOperationDefinition('dataview')!;
      const result = await dataviewDefinition.execute(router, args.action, args) as DataviewResult;

      // Format Dataview response for MCP
      if (result.error) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: result.error,
              context: result.context
            }, null, 2)
          }],
          isError: true
        };
      }

      // Format Dataview success response through presentation facade
      const rawMode = args.raw === true;
      const formattedOutput = rawMode
        ? JSON.stringify({ result: result.result, context: result.context }, null, 2)
        : formatResponse('dataview', args.action, result.result, rawMode);

      return {
        content: [{
          type: 'text' as const,
          text: formattedOutput
        }]
      };
    }

    // The tool surface and the router share one naming scheme: view owns
    // folder/read/search/fragments, files owns the structural writes.
    const request: SemanticRequest = {
      operation,
      action: args.action,
      params: args
    };
    
    const response = await router.route(request);
    
    // Format for MCP
    if (response.error) {
      // Presentation only: relabel the security layer's generic
      // PERMISSION_DENIED as READ_ONLY_MODE when read-only is what caused it, so
      // callers get an actionable reason instead of "not permitted in current
      // security mode". This makes no policy decision — the operation was already
      // refused by the gate. Deciding here is what ADR-108 removed.
      const error = plugin?.settings?.readOnlyMode &&
        (response.error as { code?: string }).code === 'PERMISSION_DENIED'
        ? {
            ...response.error,
            code: 'READ_ONLY_MODE',
            // Not "write operation" — read-only also denies EXECUTE
            // (executeCommand), which is not a write action.
            message: `Operation '${args.action}' is blocked - read-only mode is enabled`
          }
        : response.error;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error,
            workflow: response.workflow,
            context: response.context
          }, null, 2)
        }],
        isError: true
      };
    }
    
    // Check if the result is an image file for read operations
    if (operation === 'view' && args.action === 'read' && response.result) {
      const resultObj = response.result as Record<string, unknown>;
      if ('mimeType' in resultObj && 'base64Data' in resultObj) {
        // Return image content for MCP
        const imageResult = resultObj as unknown as ObsidianImageFile;
        return {
          content: [{
            type: 'image' as const,
            data: imageResult.base64Data,
            mimeType: imageResult.mimeType
          }]
        };
      }
    }

    // Only filter image files if they contain binary data that would cause JSON errors
    // For search results, we want to show image files in the results list
    const filteredResult: unknown = response.result;

    
    try {
      // Format response through presentation facade
      const rawMode = args.raw === true;
      const formattedOutput: string = rawMode
        ? JSON.stringify({
            result: filteredResult,
            workflow: response.workflow,
            context: response.context,
            efficiency_hints: response.efficiency_hints
          }, null, 2)
        : formatResponse(operation, args.action, filteredResult, rawMode);

      return {
        content: [{
          type: 'text' as const,
          text: formattedOutput
        }]
      };
    } catch (error: unknown) {
      // Handle JSON serialization errors
      Debug.error('JSON serialization failed:', error);
      return {
        content: [{
          type: 'text' as const,
          text: `Error: Unable to serialize response. ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
  };
};

export function getOperationDescription(operation: string): string {
  return getOperationDefinition(operation)?.description ?? 'Unknown operation';
}

export function getActionsForOperation(operation: string): string[] {
  const definition = getOperationDefinition(operation);
  // A copy, so a mutating caller cannot corrupt the registry.
  return definition ? [...definition.actions] : [];
}

function getAnnotationsForOperation(operation: string): ToolAnnotations | undefined {
  return getOperationDefinition(operation)?.annotations;
}

function getParametersForOperation(operation: string): Record<string, unknown> {
  return getOperationDefinition(operation)?.parameters ?? {};
}

/**
 * Create semantic tools array with optional Dataview support
 */
export function createSemanticTools(api?: ObsidianAPI, visibility?: ToolVisibility, webFetchEnabled?: boolean, allowCreateOverwrite?: boolean): SemanticTool[] {
  // Dataview joins the surface only when the plugin is installed and enabled.
  const operations = getRegisteredOperations()
    .map(definition => definition.name)
    .filter(name => name !== 'dataview' || (api !== undefined && isDataviewToolAvailable(api)));

  // Create tools, filtering by visibility (null = operation fully disabled)
  return operations
    .map(op => createSemanticTool(op, visibility, webFetchEnabled, allowCreateOverwrite))
    .filter((tool): tool is SemanticTool => tool !== null);
}

/** All operation group names (for UI enumeration), in registration order */
export const ALL_OPERATIONS: readonly string[] = getRegisteredOperations().map(definition => definition.name);

// Export the base semantic tools (for backward compatibility, no visibility filtering)
// There is deliberately no exported module-level tool list.
//
// One existed, built by calling createSemanticTool() with no visibility argument,
// which produced tools that neither filtered their action enum nor performed the
// ACTION_DISABLED check — a complete bypass of tool visibility for any caller
// that picked it up. mcp-server.ts did, on a dead request-dispatch path.
//
// Tools must be built per session via createSemanticTools(api, visibility) so the
// live settings apply. Anything needing the list of operations wants
// ALL_OPERATIONS; anything needing a tool wants createSemanticTools().