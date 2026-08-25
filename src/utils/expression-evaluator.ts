import { App, getAllTags, LinkCache } from 'obsidian';
import { parse, eval as evaluateAst } from 'expression-eval';
import { NoteContext } from '../types/bases-yaml';
import { Debug } from './debug';
import { BasesReference } from './bases-reference';

/**
 * Member names that bridge from a plain value to the `Function` constructor
 * (`x.constructor.constructor("…")()`) or the prototype chain. expression-eval
 * 5.x already blocks `constructor`/`__proto__` internally; this denylist is
 * defense-in-depth that (a) also covers `prototype`, (b) covers the computed
 * form `x["constructor"]`, and (c) does not silently weaken if the pinned
 * library's internal list changes. ADR-201's "explicit, tested no-globals
 * safety property" lives here, not in a transitive dependency.
 */
const FORBIDDEN_MEMBERS = new Set(['constructor', '__proto__', 'prototype']);

/** Minimal structural view of the jsep AST nodes we need to walk. */
interface AstNode {
  type: string;
  [key: string]: unknown;
}

/**
 * Reject any member access whose property resolves to a forbidden name,
 * whether written as `a.constructor` (Identifier) or `a["constructor"]`
 * (computed Literal). Throws so the caller's existing catch returns the
 * evaluator's safe `false` — a blocked `.base` expression fails closed,
 * exactly as a malformed one already does.
 */
function assertNoForbiddenAccess(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AstNode;

  // `this` resolves to the whole evaluation context object — no legitimate
  // use in a `.base` filter/formula, and a needless reflection surface. Reject.
  if (n.type === 'ThisExpression') {
    throw new Error('`this` is not allowed in Bases expressions');
  }

  if (n.type === 'MemberExpression') {
    const property = n.property as AstNode | undefined;
    const computed = n.computed === true;
    const name =
      !computed && property?.type === 'Identifier'
        ? (property.name as string)
        : computed && property?.type === 'Literal'
          ? String(property.value)
          : undefined;
    if (name !== undefined && FORBIDDEN_MEMBERS.has(name)) {
      throw new Error(`Access to member "${name}" is not allowed`);
    }
  }

  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      value.forEach(assertNoForbiddenAccess);
    } else if (value && typeof value === 'object') {
      assertNoForbiddenAccess(value);
    }
  }
}

/**
 * Native Bases value methods, per the Obsidian function reference
 * (Obsidian/Bases Functions.md), limited to what a filter predicate can
 * use: the expression spellings of the structured filter operator
 * vocabulary (contains, in, starts_with, ends_with, is_empty). Everything
 * else — transforms, formatting, number and date methods — is formula
 * territory and stays unimplemented; an unsupported spelling throws, so
 * it fails the query loudly instead of evaluating to a silent falsy.
 */
type ValueMethod = (...args: unknown[]) => unknown;

function nativeValueMethod(receiver: unknown, name: string): ValueMethod | undefined {
  if (name === 'isEmpty') {
    if (Array.isArray(receiver)) return () => receiver.length === 0;
    if (typeof receiver === 'string') return () => receiver.length === 0;
    if (typeof receiver === 'number') return () => false;
    if (receiver instanceof Date) return () => false;
    if (receiver !== null && typeof receiver === 'object') {
      return () => Object.keys(receiver).length === 0;
    }
    return undefined;
  }

  if (typeof receiver === 'string') {
    switch (name) {
      case 'contains': return (value: unknown) => receiver.includes(String(value));
      case 'containsAll': return (...values: unknown[]) => values.every(v => receiver.includes(String(v)));
      case 'containsAny': return (...values: unknown[]) => values.some(v => receiver.includes(String(v)));
      case 'startsWith': return (query: unknown) => receiver.startsWith(String(query));
      case 'endsWith': return (query: unknown) => receiver.endsWith(String(query));
      default: return undefined;
    }
  }

  if (Array.isArray(receiver)) {
    switch (name) {
      case 'contains': return (value: unknown) => receiver.includes(value);
      case 'containsAll': return (...values: unknown[]) => values.every(v => receiver.includes(v));
      case 'containsAny': return (...values: unknown[]) => values.some(v => receiver.includes(v));
      default: return undefined;
    }
  }

  return undefined;
}

/**
 * A comparison against NaN is always false, so NaN hidden inside an
 * expression — typically date-duration math like `now() - "90d"`, which
 * this evaluator does not model — reads as a clean falsy at the top level
 * and a filter silently excludes every note. Evaluate each arithmetic
 * node on its own and refuse on NaN. Formulas route through the same
 * pipeline behind a catch, so they degrade to their documented null.
 */
function assertNoNaNArithmetic(
  node: unknown,
  evaluate: (n: AstNode, ctx: Record<string, unknown>) => unknown,
  evalContext: Record<string, unknown>,
): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AstNode;

  if (n.type === 'BinaryExpression' || (n.type === 'UnaryExpression' && n.operator === '-')) {
    const value = evaluate(n, evalContext);
    if (typeof value === 'number' && Number.isNaN(value)) {
      throw new Error('Arithmetic evaluates to NaN — likely date-duration math this evaluator does not support');
    }
  }

  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      value.forEach(child => assertNoNaNArithmetic(child, evaluate, evalContext));
    } else if (value && typeof value === 'object') {
      assertNoNaNArithmetic(value, evaluate, evalContext);
    }
  }
}

/**
 * Rewrite `receiver.method(args)` calls into `__method(receiver, "method",
 * args)`. expression-eval resolves a method on a plain value to undefined
 * and the call quietly returns undefined — a filter then reads a clean
 * falsy and the query answers from a broken expression. The rewrite routes
 * every member call through one dispatcher the context provides. The
 * property node of a static access becomes its name as a string literal; a
 * computed access passes its expression through, evaluated as an argument.
 */
function rewriteMethodCalls(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as AstNode;

  for (const [key, value] of Object.entries(n)) {
    if (Array.isArray(value)) {
      (n as Record<string, unknown>)[key] = value.map(rewriteMethodCalls);
    } else if (value && typeof value === 'object') {
      (n as Record<string, unknown>)[key] = rewriteMethodCalls(value);
    }
  }

  if (n.type === 'CallExpression') {
    const callee = n.callee as AstNode | undefined;
    if (callee?.type === 'MemberExpression') {
      const property = callee.property as AstNode;
      const nameNode: AstNode = callee.computed === true
        ? property
        : { type: 'Literal', value: property?.name };
      n.callee = { type: 'Identifier', name: '__method' };
      n.arguments = [callee.object as AstNode, nameNode, ...n.arguments as AstNode[]];
    }
  }

  return node;
}

/**
 * A CallExpression whose callee is a bare identifier must name a function
 * the context provides. Unknown functions otherwise evaluate to nothing
 * (expression-eval resolves the identifier to undefined), which reads as a
 * clean exclusion for filters and as null for formulas — a typo must
 * instead surface as an error both paths can report.
 */
function assertNoUnknownFunctions(node: unknown, evalContext: Record<string, unknown>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AstNode;

  if (n.type === 'CallExpression') {
    const callee = n.callee as AstNode | undefined;
    if (callee?.type === 'Identifier') {
      const fn = evalContext[callee.name as string];
      if (typeof fn !== 'function') {
        throw new Error(`Unknown function "${callee.name as string}"`);
      }
    }
  }

  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      value.forEach(child => assertNoUnknownFunctions(child, evalContext));
    } else if (value && typeof value === 'object') {
      assertNoUnknownFunctions(value, evalContext);
    }
  }
}

/**
 * Evaluates Bases filter and formula expressions
 * Supports JavaScript-like syntax with property access and function calls
 */
export class ExpressionEvaluator {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Evaluate an expression string in the context of a note. Fail-closed for
   * filters: any parse or evaluation error returns `false`, so a malformed
   * or blocked expression excludes the note instead of failing the query.
   */
  evaluate(expression: string, context: NoteContext): unknown {
    try {
      return this.evaluateCore(expression, context);
    } catch (error) {
      const errorHint = BasesReference.getErrorHint(error as Error, { expression });

      Debug.log(`Expression evaluation failed for: ${expression}`);
      Debug.log(`Error: ${errorHint.error}`);
      Debug.log(`Hint: ${errorHint.hint}`);

      if (errorHint.suggestions.length > 0) {
        Debug.log('Suggestions:', errorHint.suggestions);
      }

      if (errorHint.examples && errorHint.examples.length > 0) {
        Debug.log('Examples:', errorHint.examples);
      }

      return false;
    }
  }

  /**
   * The same pipeline without the catch-all. Formula evaluation uses this
   * so a failing formula surfaces as `null` (via FormulaEngine) instead of
   * reading as the boolean false — a computed false and an error stay
   * distinguishable.
   */
  evaluateStrict(expression: string, context: NoteContext): unknown {
    return this.evaluateCore(expression, context);
  }

  private evaluateCore(expression: string, context: NoteContext): unknown {
    // Create a safe evaluation context
    const evalContext = this.createEvalContext(context);

    // Debug logging
    if (Debug.isDebugMode()) {
      Debug.log(`Evaluating expression: "${expression}"`);
      Debug.log('Context frontmatter:', context.frontmatter);
      Debug.log('Available context keys:', Object.keys(evalContext));

      // Log specific values that might be referenced in the expression
      if (expression.includes('status')) {
        Debug.log('status value:', evalContext['status'] || (evalContext['note'] as Record<string, unknown> | undefined)?.['status']);
      }
      if (expression.includes('priority')) {
        Debug.log('priority value:', evalContext['priority'] || (evalContext['note'] as Record<string, unknown> | undefined)?.['priority']);
      }
    }

    // Parse with expression-eval (jsep grammar — no `eval`/`Function`/`new`
    // and no global scope), reject prototype-chain escapes, reject calls to
    // functions the context does not provide, then evaluate against the
    // curated context. `.base` files are synced/shareable, so this must not
    // execute arbitrary JS (ADR-201).
    const ast = parse(expression);
    assertNoForbiddenAccess(ast);
    // Rewrite after the forbidden-access pass (member names must stay in
    // the tree it inspects) and before the unknown-function pass (which
    // then sees `__method`, a provided function, as the callee). The pass
    // mutates the tree in place, so `ast` keeps its parsed type.
    rewriteMethodCalls(ast);
    assertNoUnknownFunctions(ast, evalContext);
    const result: unknown = evaluateAst(ast, evalContext);
    assertNoNaNArithmetic(ast, evaluateAst as unknown as (n: AstNode, ctx: Record<string, unknown>) => unknown, evalContext);

    if (Debug.isDebugMode()) {
      Debug.log(`Expression result: ${String(result)}`);
    }

    return result;
  }

  /**
   * Create the evaluation context with all available variables and functions
   */
  private createEvalContext(context: NoteContext): Record<string, unknown> {
    const { file, frontmatter, formulas, cache } = context;
    
    // File properties object
    const fileObj = {
      name: file.basename
      , path: file.path
      , folder: file.parent?.path || ''
      , ext: file.extension
      , size: file.stat.size
      , ctime: new Date(file.stat.ctime)
      , mtime: new Date(file.stat.mtime)
      , tags: cache ? (getAllTags(cache) || []) : []
      , links: cache?.links?.map((l: LinkCache) => l.link) || []

      // File functions
      , hasTag: (...tags: string[]) => {
        const fileTags = cache ? (getAllTags(cache) || []) : [];
        return tags.some(tag => {
          // Handle both with and without # prefix
          const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
          return fileTags.includes(normalizedTag);
        });
      }
      
      , inFolder: (folder: string) => {
        const filePath = file.path;
        // Handle both with and without trailing slash
        const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
        return filePath.startsWith(normalizedFolder);
      }
      
      , hasLink: (target: string) => {
        const links: LinkCache[] = cache?.links || [];
        // Handle both [[Link]] and Link formats
        const normalizedTarget = target.replace(/^\[\[|\]\]$/g, '');
        return links.some((link: LinkCache) => link.link === normalizedTarget);
      }
      
      , hasProperty: (name: string) => {
        return name in frontmatter;
      }
    };

    // Global functions
    const globalFunctions = {
      // Date/time functions
      date: (str: string | Date) => {
        // If already a Date, return it
        if (str instanceof Date) return str;
        // Parse string to Date
        const parsed = new Date(str);
        if (isNaN(parsed.getTime())) {
          Debug.log(`Failed to parse date: ${str}`);
          return null;
        }
        return parsed;
      }
      , now: () => new Date()
      , today: () => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      }
      
      // Type conversion
      , number: (val: unknown) => Number(val)
      , string: (val: unknown) => String(val)
      
      // The native conditional. `iff` and `choice` were spellings invented
      // for the pre-ADR-201 `new Function` evaluator, where `return if(...)`
      // is a syntax error; jsep has no such reservation. They are removed:
      // only native Bases functions belong here, so habits formed against
      // this table stay valid in real .base files.
      , if: (condition: unknown, trueVal: unknown, falseVal: unknown = null) => {
        return condition ? trueVal : falseVal;
      }
      
      // Math functions
      , min: (...values: number[]) => Math.min(...values)
      , max: (...values: number[]) => Math.max(...values)
      , abs: (n: number) => Math.abs(n)
      , round: (n: number, digits: number = 0) => {
        const factor = Math.pow(10, digits);
        return Math.round(n * factor) / factor;
      }
      
      // List functions
      , list: (val: unknown): unknown[] => Array.isArray(val) ? val as unknown[] : [val]

      // The member-call dispatcher every `value.method()` expression is
      // rewritten into. Own function properties first — that is how the
      // file object exposes its helpers (hasOwnProperty keeps prototype
      // members such as `constructor` out) — then the native value
      // functions. Anything else throws so filters fail with the cause.
      , __method: (receiver: unknown, name: unknown, ...args: unknown[]): unknown => {
        if (typeof name !== 'string') {
          throw new Error('A computed method name must evaluate to a string');
        }
        if (receiver !== null && receiver !== undefined
          && Object.prototype.hasOwnProperty.call(receiver, name)) {
          const own = (receiver as Record<string, unknown>)[name];
          if (typeof own === 'function') {
            return (own as (...fnArgs: unknown[]) => unknown)(...args);
          }
        }
        const method = nativeValueMethod(receiver, name);
        if (!method) {
          throw new Error(`Unknown function "${name}"`);
        }
        return method(...args);
      }
    };

    // Pre-process frontmatter to auto-convert date-like strings
    const processedFrontmatter: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      // Auto-convert date-like properties
      if (typeof value === 'string' && 
          (key.includes('date') || key.includes('Date') || 
           key === 'due' || key === 'start' || key === 'end' || 
           key === 'created' || key === 'modified')) {
        // Try to parse as date
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          processedFrontmatter[key] = parsed;
        } else {
          processedFrontmatter[key] = value;
        }
      } else {
        processedFrontmatter[key] = value;
      }
    }

    // Build the complete context
    const evalContext: Record<string, unknown> = {
      ...globalFunctions
      , file: fileObj
      , note: processedFrontmatter // note properties with dates parsed
      , formula: formulas || {} // formula results
      
      // Allow direct access to frontmatter properties
      , ...processedFrontmatter
    };

    return evalContext;
  }

  /**
   * Parse a property path like "file.name" or "note.status"
   */
  resolvePropertyPath(path: string, context: NoteContext): unknown {
    const parts = path.split('.');
    
    if (parts[0] === 'file') {
      return this.resolveFileProperty(parts.slice(1).join('.'), context);
    } else if (parts[0] === 'note') {
      return this.resolveFrontmatterProperty(parts.slice(1).join('.'), context);
    } else if (parts[0] === 'formula') {
      return context.formulas?.[parts.slice(1).join('.')];
    } else {
      // Default to frontmatter
      return context.frontmatter[path];
    }
  }

  private resolveFileProperty(prop: string, context: NoteContext): unknown {
    const { file, cache } = context;
    
    switch (prop) {
      case 'name':
        return file.basename;
      case 'path':
        return file.path;
      case 'folder':
        return file.parent?.path || '';
      case 'ext':
        return file.extension;
      case 'size':
        return file.stat.size;
      case 'ctime':
        return new Date(file.stat.ctime);
      case 'mtime':
        return new Date(file.stat.mtime);
      case 'tags':
        return cache ? (getAllTags(cache) || []) : [];
      case 'links':
        return cache?.links?.map((l: LinkCache) => l.link) || [];
      default:
        return undefined;
    }
  }

  private resolveFrontmatterProperty(prop: string, context: NoteContext): unknown {
    return context.frontmatter[prop];
  }
}