import { App, TFile, getAllTags, CachedMetadata, LinkCache } from 'obsidian';
import { parseYaml, stringifyBaseConfig } from './yaml-bridge';
import {
  BaseYAML,
  FilterExpression,
  ViewConfig,
  NoteContext,
  BaseQueryResult,
  EvaluatedNote,
  FileProperties
} from '../types/bases-yaml';
import { BaseQueryOptions, BaseFilter } from '../types/bases';
import { Debug } from './debug';
import { ExpressionEvaluator } from './expression-evaluator';
import { FormulaEngine } from './formula-engine';
import { MCPIgnoreManager } from '../security/mcp-ignore-manager';

/**
 * Bases API implementation that matches Obsidian's actual Bases behavior.
 * The optional ignore manager scopes every enumeration and every note read to
 * the caller: the session's SecureObsidianAPI injects the folder-scoped
 * composite (ADR-110) or the plain .mcpignore manager, so listBases and
 * queryBase cannot see files outside the caller's reach.
 */
export class BasesAPI {
  private app: App;
  private ignoreManager?: MCPIgnoreManager;
  private expressionEvaluator: ExpressionEvaluator;
  private formulaEngine: FormulaEngine;

  constructor(app: App, ignoreManager?: MCPIgnoreManager) {
    this.app = app;
    this.ignoreManager = ignoreManager;
    this.expressionEvaluator = new ExpressionEvaluator(app);
    this.formulaEngine = new FormulaEngine(app);
  }

  /**
   * List all .base files in the vault
   */
  async listBases(): Promise<Array<{ path: string; name: string; views: string[] }>> {
    const bases: Array<{ path: string; name: string; views: string[] }> = [];
    const files = this.app.vault.getFiles();

    for (const file of files) {
      if (file.extension === 'base') {
        // Scoped callers must not learn that out-of-reach bases exist, and
        // their content must not be read to extract view names.
        if (this.ignoreManager?.isExcluded(file.path)) continue;
        try {
          const content = await this.app.vault.read(file);
          const baseConfig = parseYaml(content) as BaseYAML;
          
          bases.push({
            path: file.path
            , name: file.basename
            , views: baseConfig.views?.map(v => v.name) || []
          });
        } catch (error) {
          Debug.log(`Failed to parse base file ${file.path}:`, error);
        }
      }
    }

    return bases;
  }

  /**
   * Read and parse a base file
   */
  async readBase(path: string): Promise<BaseYAML> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile) || file.extension !== 'base') {
      throw new Error(`Base file not found: ${path}`);
    }

    const content = await this.app.vault.read(file);
    try {
      return parseYaml(content) as BaseYAML;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid YAML in base file: ${message}`);
    }
  }

  /**
   * Create a new base file
   */
  async createBase(path: string, config: BaseYAML): Promise<void> {
    // Validate configuration
    if (!config.views || config.views.length === 0) {
      throw new Error('Base must have at least one view');
    }

    // Convert to YAML
    const yamlContent = stringifyBaseConfig(config);

    // Create the file
    await this.app.vault.create(path, yamlContent);
  }

  /**
   * Query a base with optional view
   */
  async queryBase(basePath: string, viewName?: string, options?: BaseQueryOptions): Promise<BaseQueryResult> {
    const baseConfig = await this.readBase(basePath);

    // Get the specified view or the first one
    let view: ViewConfig | undefined;
    if (viewName) {
      view = baseConfig.views.find(v => v.name === viewName);
      if (!view) {
        throw new Error(`View not found: ${viewName}`);
      }
    } else {
      view = baseConfig.views[0];
    }

    // Get all markdown files in the vault, scoped to the caller's reach. The
    // filter runs before evaluation, so out-of-reach notes are neither read
    // nor returned — an in-scope base with broad filters cannot farm data
    // from outside the scope folder or past .mcpignore.
    const allFiles = this.app.vault.getMarkdownFiles();
    const files = this.ignoreManager
      ? allFiles.filter(file => !this.ignoreManager!.isExcluded(file.path))
      : allFiles;
    let notes: EvaluatedNote[] = [];

    // Process each file
    for (const file of files) {
      const context = await this.createNoteContext(file, baseConfig);

      // Apply global filters
      if (baseConfig.filters && !await this.evaluateFilter(baseConfig.filters, context)) {
        continue;
      }

      // Apply view filters
      if (view?.filters && !await this.evaluateFilter(view.filters, context)) {
        continue;
      }

      // Create evaluated note
      const evaluatedNote = this.createEvaluatedNote(file, context, baseConfig);

      // Caller filters narrow the base and view filters: every filter must
      // pass. They run against the evaluated properties, so file.* and
      // formula.* keys are addressable too.
      if (options?.filters && !options.filters.every(filter => this.matchesFilter(evaluatedNote, filter))) {
        continue;
      }

      notes.push(evaluatedNote);
    }

    // Native sort: the view `sort:` key orders the rows, one direction per
    // entry. `order:` is the column list, never a sort. Entries written by
    // older Obsidian versions spell the key `column:` instead of `property:`.
    if (view?.sort && view.sort.length > 0) {
      const keys = view.sort
        .map(entry => entry as { property?: string; column?: string; direction?: string })
        .map(entry => ({
          property: entry.property ?? entry.column ?? ''
          , order: String(entry.direction ?? 'ASC').toLowerCase() === 'desc' ? ('desc' as const) : ('asc' as const),
        }));
      notes = this.sortNotesBy(notes, keys);
    }

    // Caller sort refines the view sort: it runs last, ties keep the view order.
    if (options?.sort) {
      notes = this.sortNotesBy(notes, [options.sort]);
    }

    // Apply limit
    if (view?.limit) {
      notes = notes.slice(0, view.limit);
    }

    // Pagination pages the final list. The total stays the pre-page count.
    const total = notes.length;
    let page: number | undefined;
    let pageSize: number | undefined;
    if (options?.pagination) {
      page = options.pagination.page;
      pageSize = options.pagination.pageSize;
      const start = (page - 1) * pageSize;
      notes = notes.slice(start, start + pageSize);
    }

    // Property projection trims each note to the requested keys. A name
    // matches its full key or its last segment: "status" keeps "file.status".
    if (options?.properties && options.properties.length > 0) {
      const wanted = new Set(options.properties);
      notes = notes.map(note => {
        const properties: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(note.properties)) {
          if (wanted.has(key) || wanted.has(key.split('.').pop()!)) {
            properties[key] = value;
          }
        }
        return { ...note, properties };
      });
    }

    return {
      notes
      , total
      , ...(page !== undefined && pageSize !== undefined ? { page, pageSize } : {})
      , view
    };
  }

  /**
   * Export base data in various formats. Runs the same query as queryBase,
   * with the same options, and serializes the result.
   */
  async exportBase(basePath: string, format: 'csv' | 'json' | 'markdown', viewName?: string, options?: BaseQueryOptions): Promise<string> {
    const result = await this.queryBase(basePath, viewName, options);

    switch (format) {
      case 'csv':
        return this.exportToCSV(result);
      case 'json':
        return this.exportToJSON(result);
      case 'markdown':
        return this.exportToMarkdown(result);
      default: {
        // Exhaustive check - this should never happen
        const exhaustiveCheck: never = format;
        throw new Error(`Unsupported export format: ${String(exhaustiveCheck)}`);
      }
    }
  }

  // Private helper methods

  /**
   * Parse frontmatter from file content
   */
  private parseFrontmatter(content: string): Record<string, unknown> {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    
    if (!match) {
      return {};
    }
    
    try {
      // Parse YAML frontmatter
      const frontmatterText = match[1];
      const parsed = parseYaml(frontmatterText);
      
      // Ensure we return an object
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
      
      return {};
    } catch (error) {
      Debug.log('Failed to parse frontmatter:', error);
      return {};
    }
  }

  private async createNoteContext(file: TFile, baseConfig: BaseYAML): Promise<NoteContext> {
    const cache = this.app.metadataCache.getFileCache(file);
    
    // Debug logging to understand what's in the cache
    if (Debug.isDebugMode()) {
      Debug.log(`Cache for ${file.path}:`, {
        hasCache: !!cache
        , hasFrontmatter: !!(cache?.frontmatter)
        , frontmatterKeys: cache?.frontmatter ? Object.keys(cache.frontmatter) : []
        , hasFrontmatterPosition: !!(cache?.frontmatterPosition)
        , cacheStructure: cache ? Object.keys(cache) : []
      });
    }
    
    // Use Obsidian's cached frontmatter when available
    // The metadata cache should have already parsed this for us
    let frontmatter = cache?.frontmatter || {};
    
    // Only parse manually if cache is unavailable (rare edge case)
    // This might happen if the file was just created or cache is stale
    if (!cache || Object.keys(frontmatter).length === 0) {
      // Force a cache refresh first (trigger is synchronous)
      this.app.metadataCache.trigger('resolve', file);
      
      // Try cache again after refresh
      const refreshedCache = this.app.metadataCache.getFileCache(file);
      frontmatter = refreshedCache?.frontmatter || {};
      
      // Last resort: manual parse (should rarely happen)
      if (Object.keys(frontmatter).length === 0) {
        const content = await this.app.vault.read(file);
        frontmatter = this.parseFrontmatter(content);
      }
    }

    const context: NoteContext = {
      file
      , frontmatter
      , cache: cache ?? undefined
    };

    // Evaluate formulas if defined
    if (baseConfig.formulas) {
      context.formulas = {};
      for (const [name, expression] of Object.entries(baseConfig.formulas)) {
        try {
          context.formulas[name] = await this.formulaEngine.evaluate(expression, context);
        } catch (error) {
          Debug.log(`Formula evaluation failed for ${name}:`, error);
          context.formulas[name] = null;
        }
      }
    }

    return context;
  }

  private async evaluateFilter(filter: FilterExpression, context: NoteContext): Promise<boolean> {
    if (typeof filter === 'string') {
      // Evaluate expression string
      return Boolean(await this.expressionEvaluator.evaluate(filter, context));
    }

    // Handle logical operators
    if ('and' in filter) {
      for (const subFilter of filter.and) {
        if (!await this.evaluateFilter(subFilter, context)) {
          return false;
        }
      }
      return true;
    }

    if ('or' in filter) {
      for (const subFilter of filter.or) {
        if (await this.evaluateFilter(subFilter, context)) {
          return true;
        }
      }
      return false;
    }

    if ('not' in filter) {
      for (const subFilter of filter.not) {
        if (await this.evaluateFilter(subFilter, context)) {
          return false;
        }
      }
      return true;
    }

    return true;
  }

  private createEvaluatedNote(file: TFile, context: NoteContext, baseConfig: BaseYAML): EvaluatedNote {
    const fileProps = this.getFileProperties(file, context.cache);
    
    // Combine all properties
    const properties: Record<string, unknown> = {
      ...context.frontmatter
    };

    // Add file properties with prefix
    for (const [key, value] of Object.entries(fileProps)) {
      properties[`file.${key}`] = value;
    }

    // Add formula properties with prefix
    if (context.formulas) {
      for (const [key, value] of Object.entries(context.formulas)) {
        properties[`formula.${key}`] = value;
      }
    }

    return {
      path: file.path
      , name: file.basename
      , properties
      , frontmatter: context.frontmatter
      , file: fileProps
      , formulas: context.formulas
    };
  }

  private getFileProperties(file: TFile, cache: CachedMetadata | null | undefined): FileProperties {
    const tags = cache ? (getAllTags(cache) || []) : [];
    const links: string[] = cache?.links?.map((l: LinkCache) => l.link) || [];

    return {
      name: file.basename
      , path: file.path
      , folder: file.parent?.path || ''
      , ext: file.extension
      , size: file.stat.size
      , ctime: file.stat.ctime
      , mtime: file.stat.mtime
      , tags
      , links,
      // Note: backlinks are expensive, only compute if needed
      // backlinks: this.getBacklinks(file)
    };
  }

  /**
   * Direction-aware sort over one or more keys, first key primary. Nulls
   * sort last in both directions. Used by the native view `sort:` key and
   * by the caller's sortBy/sortOrder.
   */
  private sortNotesBy(notes: EvaluatedNote[], keys: Array<{ property: string; order: 'asc' | 'desc' }>): EvaluatedNote[] {
    return notes.sort((a, b) => {
      for (const key of keys) {
        const aVal = this.getPropertyValue(a, key.property);
        const bVal = this.getPropertyValue(b, key.property);
        if (aVal === bVal) continue;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const direction = key.order === 'desc' ? -1 : 1;
        return this.compareValues(aVal, bVal) * direction;
      }
      return 0;
    });
  }

  /** Numeric comparison when both sides are numbers, string comparison otherwise. */
  private compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const aStr = String(a);
    const bStr = String(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  }

  /**
   * Structured caller filter from BaseQueryOptions: { property, operator,
   * value }. This is the model of the in-app filter builder, not the raw
   * expression syntax of the .base file. String comparison ignores case
   * unless caseSensitive is true.
   */
  private matchesFilter(note: EvaluatedNote, filter: BaseFilter): boolean {
    const actual = this.getPropertyValue(note, filter.property);
    const { operator, value } = filter;
    const asString = (v: unknown): string =>
      filter.caseSensitive === true ? String(v) : String(v).toLowerCase();

    const equals = (): boolean => {
      if (typeof actual === 'string' && typeof value === 'string') {
        return asString(actual) === asString(value);
      }
      return actual === value;
    };

    const contains = (): boolean => {
      if (Array.isArray(actual)) {
        return actual.some(item => item === value || String(item) === String(value));
      }
      return actual != null && value != null && asString(actual).includes(asString(value));
    };

    const inList = (): boolean =>
      Array.isArray(value) && value.some(v => v === actual || String(v) === String(actual));

    const isEmpty = (): boolean =>
      actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0);

    switch (operator) {
      case 'equals':
        return equals();
      case 'not_equals':
        return !equals();
      case 'contains':
        return contains();
      case 'not_contains':
        return !contains();
      case 'starts_with':
        return actual != null && value != null && asString(actual).startsWith(asString(value));
      case 'ends_with':
        return actual != null && value != null && asString(actual).endsWith(asString(value));
      case 'gt':
        return actual != null && this.compareValues(actual, value) > 0;
      case 'gte':
        return actual != null && this.compareValues(actual, value) >= 0;
      case 'lt':
        return actual != null && this.compareValues(actual, value) < 0;
      case 'lte':
        return actual != null && this.compareValues(actual, value) <= 0;
      case 'between': {
        if (!Array.isArray(value) || value.length < 2) return false;
        return actual != null
          && this.compareValues(actual, value[0]) >= 0
          && this.compareValues(actual, value[1]) <= 0;
      }
      case 'in':
        return inList();
      case 'not_in':
        return !inList();
      case 'is_empty':
        return isEmpty();
      case 'is_not_empty':
        return !isEmpty();
      default:
        return false;
    }
  }

  private getPropertyValue(note: EvaluatedNote, path: string): unknown {
    // Handle different property paths
    if (path.startsWith('file.')) {
      const prop = path.substring(5);
      return note.file[prop as keyof FileProperties];
    } else if (path.startsWith('formula.')) {
      const prop = path.substring(8);
      return note.formulas?.[prop];
    } else if (path.startsWith('note.')) {
      const prop = path.substring(5);
      return note.frontmatter[prop];
    } else {
      // Default to frontmatter
      return note.frontmatter[path];
    }
  }

  private exportToCSV(result: BaseQueryResult): string {
    if (result.notes.length === 0) return '';

    // Columns come from the view `order:` key — the native column list.
    // Fall back to every property when the view does not order columns.
    const columns = (result.view?.order && result.view.order.length > 0)
      ? result.view.order
      : Object.keys(result.notes[0].properties);

    // Build CSV
    const rows: string[] = [];
    
    // Header
    rows.push(columns.map(c => this.escapeCSV(c)).join(','));

    // Data rows
    for (const note of result.notes) {
      const values = columns.map(col => {
        const value = this.getPropertyValue(note, col);
        return this.escapeCSV(value);
      });
      rows.push(values.join(','));
    }

    return rows.join('\n');
  }

  private exportToJSON(result: BaseQueryResult): string {
    return JSON.stringify(result.notes, null, 2);
  }

  private exportToMarkdown(result: BaseQueryResult): string {
    const lines: string[] = [];
    
    // Header
    lines.push(`# Base Export: ${result.view?.name || 'All Notes'}`);
    lines.push('');
    lines.push(`Total results: ${result.total}`);
    lines.push('');

    // Table
    if (result.notes.length > 0) {
      const columns = (result.view?.order && result.view.order.length > 0)
        ? result.view.order
        : Object.keys(result.notes[0].properties);
      
      // Header row
      lines.push('| ' + columns.join(' | ') + ' |');
      lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');

      // Data rows
      for (const note of result.notes) {
        const values = columns.map(col => {
          const value = this.getPropertyValue(note, col);
          return this.formatValue(value);
        });
        lines.push('| ' + values.join(' | ') + ' |');
      }
    }

    return lines.join('\n');
  }

  private formatValue(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    // At this point value is a primitive (string, number, boolean, bigint, symbol)
    const primitive = value as string | number | boolean | bigint | symbol;
    return String(primitive);
  }

  private escapeCSV(value: unknown): string {
    const str = this.formatValue(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}