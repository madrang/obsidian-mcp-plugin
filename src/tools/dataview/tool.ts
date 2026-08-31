/**
 * Dataview tool facade. Owns the plugin detector and the availability gate.
 * The work itself lives in the query, pages, values, and reference modules
 * beside it.
 */
import { ObsidianAPI } from '../../utils/obsidian-api';
import { PluginDetector } from '../../utils/plugin-detector';
import { executeDataviewQuery, validateDqlQuery } from './query';
import { listPages, getPageMetadata } from './pages';
import { generateDataviewReference } from './reference';

/**
 * Dataview tool implementation for querying vault data
 */
export class DataviewTool {
  private detector: PluginDetector;

  constructor(private api: ObsidianAPI) {
    this.detector = new PluginDetector(api.getApp());
  }

  /**
   * Check if Dataview functionality is available
   */
  isAvailable(): boolean {
    return this.detector.isDataviewAPIReady();
  }

  /**
   * Get Dataview status information
   */
  getStatus() {
    return this.detector.getDataviewStatus();
  }

  /**
   * Execute a Dataview query
   */
  async executeQuery(query: string, format: 'dql' | 'js' = 'dql'): Promise<unknown> {
    return executeDataviewQuery(this.detector, query, format);
  }

  /**
   * List all pages with metadata
   */
  listPages(source?: string): unknown {
    return listPages(this.detector, source);
  }

  /**
   * Get metadata for a specific page
   */
  getPageMetadata(path: string): unknown {
    return getPageMetadata(this.detector, path);
  }

  /**
   * Validate a DQL query syntax
   */
  validateQuery(query: string): unknown {
    return validateDqlQuery(this.detector, query);
  }

  /**
   * Generate Dataview reference content for MCP resource
   */
  static generateDataviewReference(): string {
    return generateDataviewReference();
  }
}

/**
 * Check if Dataview is available for tool registration
 */
export function isDataviewToolAvailable(api: ObsidianAPI): boolean {
  const detector = new PluginDetector(api.getApp());
  return detector.isDataviewAPIReady();
}
