/**
 * Workflow hint generation, extracted from VaultRouter.
 *
 * Pure functions: the router passes its config slices, the token gate, and
 * the session context, and these builders return the hint payloads. All
 * hints are optional guidance, never prescriptive (see types/operations.ts).
 */
import { App } from 'obsidian';
import {
  ActionConfig,
  ConditionalSuggestions,
  EfficiencyRule,
  HintConfig,
  OperationContext,
  SuggestedAction
} from '../../types/operations';
import { Params, SearchResultItem, paramStr } from '../shared';

/** Inputs the condition evaluator cannot derive on its own */
interface ConditionDeps {
  app?: App;
  dailyNotePattern?: string;
}

/**
 * Build the config-driven hint payload for an action, success or failure.
 * Returns null when the action carries no hint config.
 */
export function buildConfiguredHints(
  actionConfig: ActionConfig
  , params: Params
  , result: unknown
  , isError: boolean
  , deps: ConditionDeps
  , hasTokensFor: (condition: string) => boolean
): { message: string; suggested_next: SuggestedAction[] } | null {
  const hints: HintConfig | undefined = isError ? actionConfig.failure_hints : actionConfig.success_hints;
  if (!hints || !hints.suggested_next) {
    return null;
  }

  return {
    message: interpolateMessage(hints.message || '', params, result)
    , suggested_next: generateSuggestions(hints.suggested_next, params, result, deps, hasTokensFor)
  };
}

/**
 * Replace {placeholder} tokens with values from params and string fields of
 * the result. Unknown keys keep their placeholder text.
 */
function interpolateMessage(template: string, params: Params, result: unknown): string {
  const resultRecord = (result && typeof result === 'object') ? result as Record<string, unknown> : {};
  return template.replace(/{(\w+)}/g, (match, key: string) => {
    const paramVal = params[key];
    const resultVal = resultRecord[key];
    if (typeof paramVal === 'string') return paramVal;
    if (typeof resultVal === 'string') return resultVal;
    return match;
  });
}

function generateSuggestions(
  conditionalSuggestions: ConditionalSuggestions[]
  , params: Params
  , result: unknown
  , deps: ConditionDeps
  , hasTokensFor: (condition: string) => boolean
): SuggestedAction[] {
  const suggestions: SuggestedAction[] = [];

  if (!Array.isArray(conditionalSuggestions)) {
    return suggestions;
  }

  for (const conditional of conditionalSuggestions) {
    if (evaluateCondition(conditional.condition, params, result, deps)) {
      for (const suggestion of conditional.suggestions || []) {
        // Check if required tokens are available
        if (suggestion.requires_tokens && !hasTokensFor(suggestion.requires_tokens)) {
          continue; // Skip this suggestion - required tokens not available
        }

        suggestions.push({
          description: suggestion.description
          , command: interpolateMessage(suggestion.command, params, result)
          , reason: suggestion.reason
        });
      }
    }
  }

  return suggestions;
}

function evaluateCondition(condition: string, params: Params, result: unknown, deps: ConditionDeps): boolean {
  const resultObj = (result && typeof result === 'object') ? result as Record<string, unknown> : null;
  switch (condition) {
    case 'always':
      return true;
    case 'has_results': {
      if (!resultObj) return false;
      const results = resultObj.results;
      const totalResults = resultObj.totalResults;
      return (Array.isArray(results) && results.length > 0) || (typeof totalResults === 'number' && totalResults > 0);
    }
    case 'no_results': {
      if (!resultObj) return true;
      const results = resultObj.results;
      const totalResults = resultObj.totalResults;
      return (!Array.isArray(results) || results.length === 0) && (!totalResults || totalResults === 0);
    }
    case 'has_links': {
      if (!resultObj) return false;
      const links = resultObj.links;
      return Array.isArray(links) && links.length > 0;
    }
    case 'has_tags': {
      if (!resultObj) return false;
      const tags = resultObj.tags;
      return Array.isArray(tags) && tags.length > 0;
    }
    case 'has_markdown_files':
      return Array.isArray(result) && result.some(f => typeof f === 'string' && f.endsWith('.md'));
    case 'is_daily_note': {
      const pathVal = paramStr(params, 'path');
      if (!pathVal) return false;

      // Try to read the configured Daily Notes folder from Obsidian's internal plugin
      const dailyNotesFolder = getDailyNotesFolder(deps.app);
      if (dailyNotesFolder) {
        return pathVal.startsWith(dailyNotesFolder + '/') || pathVal === dailyNotesFolder;
      }

      // Fall back to regex pattern heuristic
      return matchesPattern(pathVal, deps.dailyNotePattern);
    }
    default:
      return false;
  }
}

/**
 * Get the configured Daily Notes folder from Obsidian's internal plugin.
 * Returns undefined if the plugin is not enabled or no folder is configured.
 */
function getDailyNotesFolder(app?: App): string | undefined {
  if (!app) return undefined;
  try {
    const internalPlugins = (app as unknown as Record<string, unknown>).internalPlugins as
      { getPluginById(id: string): { enabled: boolean; instance?: { options?: { folder?: string } } } | null } | undefined;
    if (!internalPlugins) return undefined;

    const dailyNotes = internalPlugins.getPluginById('daily-notes');
    if (dailyNotes?.enabled && dailyNotes.instance?.options?.folder) {
      return dailyNotes.instance.options.folder;
    }
  } catch {
    // Internal plugin API not available — fall back to pattern
  }
  return undefined;
}

function matchesPattern(value: string, pattern?: string): boolean {
  if (!pattern) return false;
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(value);
  } catch {
    return false;
  }
}

/**
 * Match the call against the configured efficiency rules. The rules come
 * from the workflow config; an absent rule list yields no hints.
 */
export function checkEfficiencyRules(
  operation: string
  , action: string
  , params: Params
  , rules: EfficiencyRule[] | undefined
  , lastFile?: string
): EfficiencyRule[] {
  if (!rules) return [];

  const matches: EfficiencyRule[] = [];
  for (const rule of rules) {
    // Simple pattern matching for now
    if (rule.pattern === 'multiple_edits_same_file' &&
        lastFile === params.path &&
        operation === 'edit') {
      matches.push(rule);
    }
  }

  return matches;
}

/**
 * Build the on-demand suggestions for the system.hints action from the
 * session context. A cold session gets the generic placeholder.
 */
export function buildWorkflowSuggestions(context: OperationContext): SuggestedAction[] {
  const suggestions: SuggestedAction[] = [];

  if (context.last_file) {
    suggestions.push({
      description: 'Continue working with last file'
      , command: `view(action='read', path='${context.last_file}')`
      , reason: 'Return to previous work'
    });
  }

  if (context.search_history?.length) {
    const lastSearch = context.search_history[context.search_history.length - 1];
    suggestions.push({
      description: 'Refine last search'
      , command: `view(action='search', query='${lastSearch} AND ...')`
      , reason: 'Narrow down results'
    });
  }

  // Always include a default suggestion if no context-specific ones
  if (suggestions.length === 0) {
    suggestions.push({
      description: 'Use workflow hints from other operations'
      , command: 'view(action="folder") or view(action="read", path="...")'
      , reason: 'Each operation provides contextual workflow suggestions'
    });
  }

  return suggestions;
}

/**
 * Generate enhanced hints that encourage graph exploration over simple search
 */
export function generateEnhancedHints(operation: string, action: string, params: Params, result: unknown): { message: string; suggested_next: SuggestedAction[] } | null {
  const suggestions: SuggestedAction[] = [];
  let message = '';

  const resultObj = (result && typeof result === 'object') ? result as Record<string, unknown> : null;

  // Enhanced hints for search operations
  if (operation === 'view' && action === 'search') {
    const searchResults = resultObj?.results;
    if (searchResults && Array.isArray(searchResults) && searchResults.length > 0) {
      message = 'Consider exploring connections between these files using graph operations.';

      // Get first few results for graph exploration suggestions
      const firstResult = searchResults[0] as SearchResultItem | undefined;
      const hasMultipleResults = searchResults.length > 1;

      if (firstResult?.path) {
        suggestions.push({
          description: 'Explore connections from first result'
          , command: `graph(action='traverse', sourcePath='${firstResult.path}', maxDepth=2)`
          , reason: 'Discover related files through links and references'
        });

        suggestions.push({
          description: 'Find files linking to this result'
          , command: `graph(action='backlinks', sourcePath='${firstResult.path}')`
          , reason: 'See what files reference this content'
        });

        suggestions.push({
          description: 'Find files linked from this result'
          , command: `graph(action='forwardlinks', sourcePath='${firstResult.path}')`
          , reason: 'See what this file references'
        });
      }

      if (hasMultipleResults) {
        const secondResult = searchResults[1] as SearchResultItem | undefined;
        if (secondResult?.path && firstResult?.path) {
          suggestions.push({
            description: 'Find connection path between top results'
            , command: `graph(action='path', sourcePath='${firstResult.path}', targetPath='${secondResult.path}')`
            , reason: 'Discover how these search results are connected'
          });
        }
      }

      // Tag-based exploration if we detect potential tag-related content
      const queryParam = paramStr(params, 'query');
      if (queryParam && queryParam.includes('#')) {
        const tagQuery = queryParam.replace('#', '');
        suggestions.push({
          description: 'Explore files with similar tags'
          , command: `graph(action='tag-analysis', tagFilter=['${tagQuery}'])`
          , reason: 'Find files grouped by similar tags'
        });
      }
    }
  }

  // Enhanced hints for read operations - suggest exploring connections
  if (operation === 'view' && action === 'read') {
    const readPath = paramStr(params, 'path');
    const hasError = resultObj ? 'error' in resultObj : false;
    if (readPath && !hasError) {
      message = 'Explore connections and references for deeper context.';

      suggestions.push({
        description: 'Explore graph connections from this file'
        , command: `graph(action='neighbors', sourcePath='${readPath}')`
        , reason: 'Find directly connected files'
      });

      suggestions.push({
        description: 'Find files that reference this one'
        , command: `graph(action='backlinks', sourcePath='${readPath}')`
        , reason: 'See where this file is mentioned or linked'
      });

      // Check if the content suggests it might have many connections
      const rawContent = typeof result === 'string' ? result : (resultObj?.content ?? '');

      // Safely count links and tags, handling both string content and Fragment arrays
      let linkCount = 0;
      let tagCount = 0;
      // The read result's tags array is the authoritative tag count: it
      // carries frontmatter tags, skips code-text false positives, and a
      // repeated tag counts once. The text scan is the fallback for result
      // shapes without one.
      const resultTags = resultObj?.tags;

      if (typeof rawContent === 'string') {
        linkCount = (rawContent.match(/\[\[.*?\]\]/g) || []).length;
        tagCount = Array.isArray(resultTags)
          ? new Set(resultTags as string[]).size
          : (rawContent.match(/#\w+/g) || []).length;
      } else if (Array.isArray(rawContent)) {
        // Handle Fragment[] - extract content from each fragment
        for (const fragment of rawContent) {
          let fragmentText = '';
          if (typeof fragment === 'string') {
            fragmentText = fragment;
          } else if (fragment && typeof fragment === 'object') {
            const fObj = fragment as Record<string, unknown>;
            const fVal = fObj.content ?? fObj.text ?? fObj.data;
            fragmentText = typeof fVal === 'string' ? fVal : '';
          }
          if (fragmentText.length > 0) {
            linkCount += (fragmentText.match(/\[\[.*?\]\]/g) || []).length;
            tagCount += (fragmentText.match(/#\w+/g) || []).length;
          }
        }
        if (Array.isArray(resultTags)) {
          tagCount = new Set(resultTags as string[]).size;
        }
      }

      if (linkCount > 2) {
        suggestions.push({
          description: 'Traverse the link network from this file'
          , command: `graph(action='traverse', sourcePath='${readPath}', maxDepth=3)`
          , reason: `This file has ${linkCount} links - explore the broader network`
        });
      }

      if (tagCount > 0) {
        suggestions.push({
          description: 'Find files with similar tags'
          , command: `graph(action='tag-traverse', startPath='${readPath}', maxDepth=2)`
          , reason: `This file has ${tagCount} tags - explore related content`
        });
      }
    }
  }

  // Enhanced hints for list operations - suggest exploring discovered files
  if (operation === 'view' && action === 'folder') {
    if (result && Array.isArray(result) && result.length > 1) {
      message = 'Consider exploring relationships between these files.';

      const mdFiles = result.filter((f): f is string => typeof f === 'string' && f.endsWith('.md'));
      if (mdFiles.length >= 2) {
        suggestions.push({
          description: 'Find connections between files in this directory'
          , command: `graph(action='path', sourcePath='${mdFiles[0]}', targetPath='${mdFiles[1]}')`
          , reason: 'Discover how files in this directory relate to each other'
        });

        suggestions.push({
          description: 'Analyze tag relationships in this directory'
          , command: `graph(action='tag-analysis', folderFilter='${paramStr(params, 'path') || '/'}')`
          , reason: 'Find common themes and tags among these files'
        });
      }
    } else if (resultObj && 'files' in resultObj && Array.isArray(resultObj.files)) {
      // Handle paginated results
      interface PaginatedFile { name: string; path: string; type: string }
      const paginatedFiles = resultObj.files as PaginatedFile[];
      const mdFiles = paginatedFiles.filter(f => f.name && f.name.endsWith('.md'));
      if (mdFiles.length >= 2) {
        message = 'Consider exploring relationships between these files.';

        suggestions.push({
          description: 'Find connections between files in this directory'
          , command: `graph(action='path', sourcePath='${mdFiles[0].path}', targetPath='${mdFiles[1].path}')`
          , reason: 'Discover how files in this directory relate to each other'
        });
      }
    }
  }

  // Enhanced hints for fragments operation - suggest broader exploration
  if (operation === 'view' && action === 'fragments') {
    const fragments = resultObj?.fragments;
    if (fragments && Array.isArray(fragments) && fragments.length > 0) {
      message = 'Explore connections between documents containing these fragments.';

      const sourcePathsSet = new Set<string>();
      for (const f of fragments) {
        if (f && typeof f === 'object' && 'source' in (f as Record<string, unknown>)) {
          const source = String((f as Record<string, unknown>).source);
          if (source.length > 0) sourcePathsSet.add(source);
        }
      }
      const sourcePaths = [...sourcePathsSet];
      if (sourcePaths.length >= 2) {
        const firstPath = sourcePaths[0];
        const secondPath = sourcePaths[1];
        suggestions.push({
          description: 'Find connections between fragment sources'
          , command: `graph(action='path', sourcePath='${firstPath}', targetPath='${secondPath}')`
          , reason: 'Explore how documents with similar content are connected'
        });

        suggestions.push({
          description: 'Traverse network from first fragment source'
          , command: `graph(action='traverse', sourcePath='${firstPath}', maxDepth=2)`
          , reason: 'Discover the broader context around this content'
        });
      }
    }
  }

  return suggestions.length > 0 ? { message, suggested_next: suggestions } : null;
}
