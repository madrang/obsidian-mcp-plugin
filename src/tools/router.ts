import { ObsidianAPI } from '../utils/obsidian-api';
import {
  OperationResponse,
  WorkflowConfig,
  OperationContext,
  OperationRequest,
  SuggestedAction
} from '../types/operations';
import { ContentBufferManager } from '../utils/content-buffer';
import { StateTokenManager } from './state-tokens';
import { limitResponse } from '../utils/response-limiter';
import { UniversalFragmentRetriever } from '../indexing/fragment-retriever';
import { GraphSearchTool } from './graph/search';
import { GraphSearchTool as GraphSearchTraversalTool } from './graph/search-tool';
import { GraphTagTool } from './graph/tag-tool';
import { App } from 'obsidian';
import { InputValidator } from '../validation/input-validator';
import { RouterContext } from './router-context';
import { getOperationDefinition } from './tool-registry';
// Side-effect import: populates the registry executeOperation dispatches
// through. It must live here, not only in tool-factory.ts, so a direct
// VaultRouter construction also sees every registered handler.
import './definitions';
import { Params, paramStr } from './shared';
import { buildConfiguredHints, buildWorkflowSuggestions, checkEfficiencyRules, generateEnhancedHints } from './system/hints';
import { ResourceService } from '../resources/types';

export class VaultRouter implements RouterContext {
  private config!: WorkflowConfig;
  private context: OperationContext = {};
  // Public to satisfy RouterContext — the router passes itself as the
  // dependency context to extracted operation modules (ADR-202, #199).
  readonly api: ObsidianAPI;
  private tokenManager: StateTokenManager;
  readonly fragmentRetriever: UniversalFragmentRetriever;
  readonly graphSearchTool?: GraphSearchTool;
  readonly graphSearchTraversalTool?: GraphSearchTraversalTool;
  readonly graphTagTool?: GraphTagTool;
  readonly app?: App;
  readonly validator: InputValidator;
  readonly resources?: ResourceService;

  constructor(api: ObsidianAPI, app?: App, resources?: ResourceService) {
    this.api = api;
    this.app = app;
    this.resources = resources;
    this.tokenManager = new StateTokenManager();
    this.fragmentRetriever = new UniversalFragmentRetriever();
    this.validator = new InputValidator();
    if (app) {
      this.graphSearchTool = new GraphSearchTool(api, app);
      this.graphSearchTraversalTool = new GraphSearchTraversalTool(app, api);
      this.graphTagTool = new GraphTagTool(app, api);
    }
    this.loadConfig();
  }
  
  private loadConfig() {
    // Use default configuration - in the future this could be loaded from Obsidian plugin settings
    this.config = this.getDefaultConfig();
  }
  
  private getDefaultConfig(): WorkflowConfig {
    return {
      version: '1.0.0'
      , description: 'Default workflow configuration'
      , operations: {
        files: {
          description: 'File operations'
          , actions: {}
        }
        , edit: {
          description: 'Edit operations' 
          , actions: {}
        }
      }
    };
  }
  
  /**
   * Route an operation request to the appropriate handler and enrich the response
   */
  async route(request: OperationRequest): Promise<OperationResponse> {
    const { operation, action, params } = request;
    
    // Update context
    this.updateContext(operation, action, params);
    
    try {
      // Execute the actual operation
      const result = await this.executeOperation(operation, action, params);
      
      // Update tokens based on success
      this.tokenManager.updateTokens(operation, action, params, result, true);
      
      // Enrich with workflow hints
      const response = this.enrichResponse(result, operation, action, params, false);
      
      // Update context with successful result
      this.updateContextAfterSuccess(response, params);
      
      return response;
      
    } catch (error: unknown) {
      // Update tokens for failure
      this.tokenManager.updateTokens(operation, action, params, null, false);
      
      // Handle errors with recovery hints
      return this.handleError(error, operation, action, params);
    }
  }
  
  /**
   * Dispatch an operation request to the handler the operation registered in
   * its definition module (src/tools/definitions).
   */
  private async executeOperation(operation: string, action: string, params: Params): Promise<unknown> {
    const definition = getOperationDefinition(operation);
    if (!definition) {
      throw new Error(`Unknown operation: ${operation}`);
    }
    return definition.execute(this, action, params);
  }

  private enrichResponse(result: unknown, operation: string, action: string, params: Params, isError: boolean): OperationResponse {
    const operationConfig = this.config?.operations?.[operation];
    const actionConfig = operationConfig?.actions?.[action];
    
    // Skip limiting for read operations - we want the full document/image
    const shouldLimit = !(operation === 'view' && action === 'read');
    
    // Limit the result size to prevent token overflow (except for reads)
    const limitedResult = shouldLimit ? limitResponse(result) : result;
    
    const response: OperationResponse = {
      result: limitedResult
      , context: this.getCurrentContext()
    };
    
    // Add workflow hints
    if (actionConfig) {
      const configuredHints = buildConfiguredHints(
        actionConfig
        , params
        , result
        , isError
        , { app: this.app, dailyNotePattern: this.config.context_triggers?.daily_note_pattern }
        , (condition) => this.tokenManager.hasTokensFor(condition)
      );
      if (configuredHints) {
        response.workflow = configuredHints;
      }
    }
    
    // Add enhanced hints for search and other operations to encourage graph exploration
    if (!isError) {
      const enhancedHints = generateEnhancedHints(operation, action, params, result);
      if (enhancedHints && enhancedHints.suggested_next.length > 0) {
        if (response.workflow) {
          // Merge with existing workflow hints
          response.workflow.suggested_next = [
            ...response.workflow.suggested_next
            , ...enhancedHints.suggested_next
          ];
          response.workflow.message += ' ' + enhancedHints.message;
        } else {
          response.workflow = enhancedHints;
        }
      }
    }
    
    // Add efficiency hints
    const efficiencyHints = checkEfficiencyRules(operation, action, params, this.config.efficiency_rules, this.context.last_file);
    if (efficiencyHints.length > 0) {
      response.efficiency_hints = {
        message: efficiencyHints[0].hint
        , alternatives: efficiencyHints.slice(1).map(h => h.hint)
      };
    }
    
    return response;
  }
  
  private updateContext(operation: string, action: string, params: Params) {
    this.context.operation = operation;
    this.context.action = action;
    const pathVal = paramStr(params, 'path');

    if (pathVal) {
      this.context.last_file = pathVal;
      
      // Track file history
      if (!this.context.file_history) {
        this.context.file_history = [];
      }
      if (!this.context.file_history.includes(pathVal)) {
        this.context.file_history.push(pathVal);
        // Keep only last 10 files
        if (this.context.file_history.length > 10) {
          this.context.file_history.shift();
        }
      }
    }
    
    // view.folder carries its scope on `path`.
    const dirVal = operation === 'view' && action === 'folder' ? paramStr(params, 'path') : undefined;
    if (dirVal) {
      this.context.last_directory = dirVal;
    }

    const queryVal = paramStr(params, 'query');
    if (queryVal) {
      if (!this.context.search_history) {
        this.context.search_history = [];
      }
      this.context.search_history.push(queryVal);
      // Keep only last 5 searches
      if (this.context.search_history.length > 5) {
        this.context.search_history.shift();
      }
    }
  }
  
  private updateContextAfterSuccess(response: OperationResponse, _params: Params) {
    // Update context based on the operation
    const tokens = this.tokenManager.getTokens();
    
    if (tokens.file_loaded) {
      this.context.last_file = tokens.file_loaded;
      this.context.file_history = tokens.file_history;
    }
    
    if (tokens.directory_listed) {
      this.context.last_directory = tokens.directory_listed;
    }
    
    if (tokens.search_query) {
      if (!this.context.search_history) {
        this.context.search_history = [];
      }
      if (!this.context.search_history.includes(tokens.search_query)) {
        this.context.search_history.push(tokens.search_query);
      }
    }
  }
  
  private getCurrentContext() {
    const tokens = this.tokenManager.getTokens();
    
    return {
      current_file: this.context.last_file
      , current_directory: this.context.last_directory
      , buffer_available: ContentBufferManager.getInstance().retrieve() !== null
      , file_history: this.context.file_history
      , search_history: this.context.search_history
      // Include relevant token states
      , has_file_content: tokens.file_content
      , has_links: (tokens.file_has_links?.length ?? 0) > 0
      , has_tags: (tokens.file_has_tags?.length ?? 0) > 0
      , search_results_available: tokens.search_has_results
      , linked_files: tokens.file_has_links
      , tags: tokens.file_has_tags
    };
  }
  
  private handleError(error: unknown, operation: string, action: string, params: Params): OperationResponse {
    const errorResponse = this.enrichResponse(
      null,
      operation,
      action,
      params,
      true // isError
    );

    // Extract parent directory from the folder path for suggestions
    const dirParam = paramStr(params, 'path');
    if (operation === 'view' && action === 'folder' && dirParam) {
      const parts = dirParam.split('/');
      if (parts.length > 1) {
        parts.pop();
        params.parent_directory = parts.join('/') || undefined;
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error && typeof error === 'object' && 'code' in error) ? String((error as Record<string, unknown>).code) : undefined;
    errorResponse.error = {
      code: errorCode || 'UNKNOWN_ERROR'
      , message: errorMessage
      , recovery_hints: errorResponse.workflow?.suggested_next
    };
    
    delete errorResponse.workflow; // Move suggestions to recovery_hints
    
    return errorResponse;
  }
  
  generateWorkflowSuggestions(): { current_context: ReturnType<VaultRouter['getCurrentContext']>; suggestions: SuggestedAction[] } {
    return {
      current_context: this.getCurrentContext()
      , suggestions: buildWorkflowSuggestions(this.context)
    };
  }

}