import { App } from 'obsidian';
import { NoteContext } from '../types/bases-yaml';
import { ExpressionEvaluator } from './expression-evaluator';
import { Debug } from './debug';
import { BasesReference } from './bases-reference';

/**
 * Evaluates formula expressions for Bases
 * Handles formula dependencies and caching
 */
export class FormulaEngine {
  private app: App;
  private expressionEvaluator: ExpressionEvaluator;
  private formulaCache: Map<string, unknown> = new Map();

  constructor(app: App) {
    this.app = app;
    this.expressionEvaluator = new ExpressionEvaluator(app);
  }

  /**
   * Evaluate a formula expression
   */
  async evaluate(expression: string, context: NoteContext): Promise<unknown> {
    // Check cache first
    const cacheKey = `${context.file.path}:${expression}`;
    if (this.formulaCache.has(cacheKey)) {
      return this.formulaCache.get(cacheKey);
    }

    try {
      // Strict pipeline: a failing formula throws here and surfaces as
      // null, so an error never reads as the computed boolean false.
      // Unknown functions do not throw — the callee resolves to nothing —
      // so an undefined result is normalized to null under the same
      // contract: a formula that cannot produce a value evaluates to null.
      const result = await this.expressionEvaluator.evaluateStrict(expression, context);
      if (result === undefined) {
        Debug.log(`Formula evaluated to nothing: ${expression}`);
        return null;
      }

      // Cache the result
      this.formulaCache.set(cacheKey, result);

      return result;
    } catch (error) {
      const errorHint = BasesReference.getErrorHint(error as Error, { expression });
      
      Debug.log(`Formula evaluation failed: ${expression}`);
      Debug.log(`Error: ${errorHint.error}`);
      Debug.log(`Hint: ${errorHint.hint}`);
      
      if (errorHint.suggestions.length > 0) {
        Debug.log('Suggestions:', errorHint.suggestions);
      }
      
      return null;
    }
  }

  /**
   * Clear the formula cache
   */
  clearCache(): void {
    this.formulaCache.clear();
  }

  /**
   * Clear cache for a specific file
   */
  clearFileCache(filePath: string): void {
    for (const key of this.formulaCache.keys()) {
      if (key.startsWith(filePath + ':')) {
        this.formulaCache.delete(key);
      }
    }
  }
}