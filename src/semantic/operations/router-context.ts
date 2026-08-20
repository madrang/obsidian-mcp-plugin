/**
 * RouterContext — the dependency surface a SemanticRouter exposes to the
 * extracted per-operation modules (ADR-202).
 *
 * `SemanticRouter implements RouterContext`, and the router instance itself
 * is passed as the context, so mutations of shared state propagate back to
 * the router without getter/setter indirection.
 *
 * The interface covers every extracted handler: the file and edit actions
 * use api and validator, the view fragments use fragmentRetriever, the graph
 * actions use the graph tools, and system.hints uses the workflow suggestion
 * generator, which keeps its state on the router.
 */
import { App } from 'obsidian';
import { ObsidianAPI } from '../../utils/obsidian-api';
import { UniversalFragmentRetriever } from '../../indexing/fragment-retriever';
import { InputValidator } from '../../validation/input-validator';
import { GraphSearchTool } from '../../tools/graph-search';
import { GraphSearchTool as GraphSearchTraversalTool } from '../../tools/graph-search-tool';
import { GraphTagTool } from '../../tools/graph-tag-tool';
import { SuggestedAction } from '../../types/semantic';

export interface RouterContext {
  readonly api: ObsidianAPI;
  readonly app?: App;
  readonly fragmentRetriever: UniversalFragmentRetriever;
  readonly validator: InputValidator;
  readonly graphSearchTool?: GraphSearchTool;
  readonly graphSearchTraversalTool?: GraphSearchTraversalTool;
  readonly graphTagTool?: GraphTagTool;
  generateWorkflowSuggestions(): { current_context: unknown; suggestions: SuggestedAction[] };
}
