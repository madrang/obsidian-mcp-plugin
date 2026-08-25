import { App, Platform, TFile, TFolder, TAbstractFile, Command, getAllTags } from 'obsidian';
import { ObsidianConfig, ObsidianFile, ObsidianFileResponse, FileStatResponse } from '../types/obsidian';
import { contentHash } from './content-hash';
import { paginateFiles } from './response-limiter';
import { isImageFile as checkIsImageFile, processImageResponse, IMAGE_PROCESSING_PRESETS } from './image-handler';
import { getVersion } from '../version';
import { SearchResult } from './advanced-search';
import { SearchFacade } from './search-facade';
import { MCPIgnoreManager } from '../security/mcp-ignore-manager';
import { Minimatch } from 'minimatch';
import { stringify } from 'yaml';
import { Debug } from './debug';
import { BasesAPI } from './bases-api';
import { BaseYAML, BaseQueryResult as BasesQueryResult } from '../types/bases-yaml';
import { BaseQueryOptions } from '../types/bases';
import { InputValidator, ValidationException, ValidationConfig } from '../validation/input-validator';

/** MCP server info used by ObsidianAPI */
interface ObsidianAPIMCPServerInfo {
  isServerRunning(): boolean;
  getConnectionCount(): number;
}

/** Minimal plugin interface for ObsidianAPI dependency */
export interface ObsidianAPIPluginRef {
  settings?: {
    validation?: Partial<ValidationConfig>;
    enableWebFetch?: boolean;
    httpEnabled?: boolean;
    httpsEnabled?: boolean;
    httpPort?: number;
    httpsPort?: number;
    sessionsPerToken?: number;
  };
  ignoreManager?: MCPIgnoreManager;
  mcpServer?: ObsidianAPIMCPServerInfo;
  manifest?: { dir?: string };
}

/** Internal Obsidian App interface exposing commands */
interface AppInternal extends App {
  commands?: {
    commands?: Record<string, ObsidianCommand>;
    executeCommandById?(id: string): boolean;
  };
}

/** Internal Obsidian command structure */
interface ObsidianCommand {
  id: string;
  name: string;
  icon?: string;
}

/** Structured patch parameters for vault file operations */
export interface PatchParams {
  targetType?: string;
  target?: string;
  operation?: string;
  content?: string;
  /** Typed value for a frontmatter field: any JSON type, serialized as
   *  YAML. Works with operation 'replace' only. Mutually exclusive with
   *  content/newText. */
  value?: unknown;
  old_text?: string;
  new_text?: string;
  position?: number;
  text?: string;
  start?: number;
  end?: number;
}

/** File listing detail object */
interface FileDetailObject {
  path: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  extension?: string;
  modified?: number;
}

export class ObsidianAPI {
  private app: App;
  private config: ObsidianConfig;
  private plugin?: ObsidianAPIPluginRef; // Reference to the plugin for accessing MCP server info
  private ignoreManager?: MCPIgnoreManager;
  private basesAPI: BasesAPI;
  private validator: InputValidator;
  private searchFacade: SearchFacade;

  constructor(app: App, config?: ObsidianConfig, plugin?: ObsidianAPIPluginRef) {
    this.app = app;
    this.config = config || { apiKey: '', apiUrl: '' };
    this.plugin = plugin;
    this.ignoreManager = plugin?.ignoreManager;
    // The ignore manager rides along so every bases enumeration and query is
    // scoped to the caller this API instance serves: the session's
    // SecureObsidianAPI passes a folder-scoped manager (ADR-110), the main
    // instance the plain .mcpignore manager.
    this.basesAPI = new BasesAPI(app, this.ignoreManager);
    this.searchFacade = new SearchFacade(app);

    // Initialize input validator with plugin settings or defaults
    const validationSettings: Partial<ValidationConfig> = plugin?.settings?.validation ?? {};
    this.validator = new InputValidator(validationSettings);

    Debug.log(`ObsidianAPI initialized with ignoreManager: ${!!this.ignoreManager}, enabled: ${this.ignoreManager?.getEnabled()}`);
  }

  // Getter to access the App instance for graph operations
  getApp(): App {
    return this.app;
  }

  // Getter to access the ignore manager so graph traversal can honor exclusions
  getIgnoreManager(): MCPIgnoreManager | undefined {
    return this.ignoreManager;
  }

  // Server info
  getServerInfo() {
    const baseInfo = {
      authenticated: true
      , cors: true
      , ok: true
      , service: 'Obsidian MCP Plugin'
      , versions: {
        // Platform.version is the About-page string, set by app boot. It is
        // not in the public typings yet and can be absent in odd builds —
        // Unknown says so. A plausible fake such as 1.0.0 hides the failure.
        obsidian: (Platform as { version?: string }).version ?? 'Unknown'
        , 'self': getVersion()
      }
    };

    // Read Daily Notes plugin config
    const dailyNotesFolder = this.getDailyNotesFolder();

    // Add MCP server connection info if plugin is available
    if (this.plugin?.mcpServer) {
      const mcpServer = this.plugin.mcpServer;
      const pluginSettings = this.plugin.settings;
      return {
        ...baseInfo
        , mcp: {
          running: mcpServer.isServerRunning()
          , httpEnabled: pluginSettings?.httpEnabled
          , httpsEnabled: pluginSettings?.httpsEnabled
          , httpPort: pluginSettings?.httpPort
          , httpsPort: pluginSettings?.httpsPort
          , connections: mcpServer.getConnectionCount() ?? -1
          , maxSessions: pluginSettings?.sessionsPerToken
          , vault: this.app.vault.getName()
        }
        , ...(dailyNotesFolder !== undefined && { dailyNotesFolder })
      };
    }

    return { ...baseInfo, ...(dailyNotesFolder !== undefined && { dailyNotesFolder }) };
  }

  /**
   * Get the configured Daily Notes folder from Obsidian's internal plugin.
   */
  private getDailyNotesFolder(): string | undefined {
    try {
      const internalPlugins = (this.app as unknown as Record<string, unknown>).internalPlugins as
        { getPluginById(id: string): { enabled: boolean; instance?: { options?: { folder?: string } } } | null } | undefined;
      if (!internalPlugins) return undefined;

      const dailyNotes = internalPlugins.getPluginById('daily-notes');
      if (dailyNotes?.enabled && dailyNotes.instance?.options?.folder) {
        return dailyNotes.instance.options.folder;
      }
    } catch {
      // Internal plugin API not available
    }
    return undefined;
  }

  // Active file operations
  async getActiveFile(): Promise<ObsidianFile> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    const content = await this.app.vault.read(activeFile);

    // Extract metadata from cache
    const cache = this.app.metadataCache.getFileCache(activeFile);
    const tags = cache ? (getAllTags(cache) || []) : [];
    const frontmatter = cache?.frontmatter ? { ...cache.frontmatter } : {};

    // Remove position metadata from frontmatter (internal Obsidian data)
    if (frontmatter.position) {
      delete frontmatter.position;
    }

    return {
      path: activeFile.path
      , content
      , tags
      , frontmatter
    };
  }

  async updateActiveFile(content: string) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    await this.app.vault.modify(activeFile, content);
    return { success: true };
  }

  async appendToActiveFile(content: string) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    const existingContent = await this.app.vault.read(activeFile);
    await this.app.vault.modify(activeFile, existingContent + content);
    return { success: true };
  }

  async deleteActiveFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    await this.app.fileManager.trashFile(activeFile);
    return { success: true };
  }

  async patchActiveFile(params: PatchParams) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    return await this.patchVaultFile(activeFile.path, params);
  }

  // Vault file operations
  listFiles(directory?: string): Promise<string[]> {
    const vault = this.app.vault;
    let files: TAbstractFile[];

    if (directory && directory !== '/') {
      const folder = vault.getAbstractFileByPath(directory);
      if (!folder || !(folder instanceof TFolder)) {
        throw new Error(`Directory not found: ${directory}`);
      }
      // Walk the folder tree to collect every descendant. Matches the
      // recursive semantics of vault.getAllLoadedFiles() for the root
      // case, so a caller doesn't see an empty list when a folder only
      // contains subfolders.
      files = [];
      const stack: TAbstractFile[] = [...folder.children];
      while (stack.length > 0) {
        const f = stack.pop()!;
        files.push(f);
        if (f instanceof TFolder) {
          stack.push(...f.children);
        }
      }
    } else {
      files = vault.getAllLoadedFiles();
    }

    // Return file paths, filtering out folders and excluded paths
    const filePaths = files
      .filter(file => file instanceof TFile)
      .map(file => file.path)
      .sort();

    // Filter out excluded paths
    const result = this.ignoreManager ? this.ignoreManager.filterPaths(filePaths) : filePaths;
    return Promise.resolve(result);
  }

  listFilesPaginated(
    directory?: string,
    page: number = 1,
    pageSize: number = 20,
    recursive: boolean = false,
    pattern?: string
  ): Promise<{
    files: Array<{
      path: string;
      name: string;
      type: 'file' | 'folder';
      size?: number;
      extension?: string;
      modified?: number;
    }>;
    page: number;
    pageSize: number;
    totalFiles: number;
    totalPages: number;
    directory?: string;
    pattern?: string;
  }> {
    const vault = this.app.vault;
    let files: TAbstractFile[];

    if (directory && directory !== '/') {
      const folder = vault.getAbstractFileByPath(directory);
      if (!folder || !(folder instanceof TFolder)) {
        throw new Error(`Directory not found: ${directory}`);
      }
      if (recursive) {
        // Walk the tree and keep only files — pagination is over the same
        // flat universe listFiles() returns, so an agent paging through a
        // directory sees a coherent, consistent set of items.
        files = [];
        const stack: TAbstractFile[] = [...folder.children];
        while (stack.length > 0) {
          const f = stack.pop()!;
          if (f instanceof TFile) {
            files.push(f);
          } else if (f instanceof TFolder) {
            stack.push(...f.children);
          }
        }
      } else {
        files = folder.children;
      }
    } else {
      files = vault.getAllLoadedFiles();
    }

    // Create detailed file objects
    let fileObjects: FileDetailObject[] = files.map(file => {
      const isFile = file instanceof TFile;
      const result: FileDetailObject = {
        path: file.path
        , name: file.name
        , type: isFile ? 'file' : 'folder'
      };

      if (isFile) {
        result.size = file.stat.size;
        result.extension = file.extension;
        result.modified = file.stat.mtime;
      }

      return result;
    }).sort((a: FileDetailObject, b: FileDetailObject) => {
      if (recursive) {
        // Match listFiles() — full-path lexicographic. The agent's
        // "use page=N" hint anchors to the same total order, so page
        // boundaries are stable across calls and basename collisions
        // (e.g. two index.md in different subfolders) sort deterministically.
        return a.path.localeCompare(b.path);
      }
      // Level-only mode: folders first, then files by basename — what
      // existing internal callers (cp recursion, isDirectory probe)
      // depend on for tree navigation.
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // A glob filters the listing before pagination, so page N is the Nth
    // slice of the filtered walk — same contract as the unfiltered pages.
    // matchBase: a pattern with no '/' (e.g. '*.md') matches the file name
    // at any depth; '**' crosses folder boundaries, '*' stays in one folder.
    if (pattern !== undefined && pattern !== '') {
      const glob = new Minimatch(pattern, { matchBase: true });
      fileObjects = fileObjects.filter(file => glob.match(file.path));
    }

    const result = paginateFiles(fileObjects, page, pageSize, directory);
    return Promise.resolve(pattern !== undefined && pattern !== ''
      ? { ...result, pattern }
      : result);
  }

  async getFile(path: string): Promise<ObsidianFileResponse> {
    // Check if path is excluded
    if (this.ignoreManager && this.ignoreManager.isExcluded(path)) {
      throw new Error(`File not found: ${path}`);
    }
    
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }

    // Check if it's an image file
    if (checkIsImageFile(path)) {
      const arrayBuffer = await this.app.vault.readBinary(file);
      return await processImageResponse(path, arrayBuffer, IMAGE_PROCESSING_PRESETS.none);
    }

    // Regular text file
    const content = await this.app.vault.read(file);

    // Extract metadata from cache
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? (getAllTags(cache) || []) : [];
    const frontmatter = cache?.frontmatter ? { ...cache.frontmatter } : {};

    // Remove position metadata from frontmatter (internal Obsidian data)
    if (frontmatter.position) {
      delete frontmatter.position;
    }

    return {
      path: file.path
      , content
      , tags
      , frontmatter
      , mtime: file.stat.mtime
    };
  }

  /**
   * Metadata and content hash for a file. Internal primitive, deliberately
   * NOT a tool action: hash and mtime must not be obtainable without
   * reading the content. They surface only as extra fields on a read that
   * returns the complete file (raw mode shows them), and feed the edit
   * tool's ifUnmodifiedSince / ifHash write preconditions. Text files also
   * report lineCount and hash; image files report only the filesystem
   * fields, since neither is meaningful for binary content. An excluded
   * path reports exists: false, the same answer getFile gives by throwing
   * "File not found".
   */
  async getFileStat(path: string): Promise<FileStatResponse> {
    if (this.ignoreManager && this.ignoreManager.isExcluded(path)) {
      return { path, exists: false };
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return { path, exists: false };
    }

    const stat: FileStatResponse = {
      path: file.path
      , exists: true
      , size: file.stat.size
      , mtime: file.stat.mtime
      , ctime: file.stat.ctime
    };

    if (!checkIsImageFile(path)) {
      const content = await this.app.vault.cachedRead(file);
      stat.lineCount = content.split('\n').length;
      stat.hash = contentHash(content);
    }

    return stat;
  }

  async createFile(path: string, content: string) {
    // Validate input
    const validationResult = this.validator.validate('file.create', { path, content });
    if (!validationResult.valid) {
      throw new ValidationException(
        validationResult.errors || [],
        `Validation failed for createFile: ${validationResult.errors?.map(e => e.message).join(', ')}`
      );
    }

    // Check if path is excluded
    if (this.ignoreManager && this.ignoreManager.isExcluded(path)) {
      throw new Error(`Access denied: ${path}`);
    }

    // Ensure directory exists
    const dirPath = path.substring(0, path.lastIndexOf('/'));
    if (dirPath && !this.app.vault.getAbstractFileByPath(dirPath)) {
      await this.ensureDirectoryExists(dirPath);
    }

    const result = await this.withVaultRetry(
      async () => {
        const file = await this.app.vault.create(path, content);
        return {
          success: true
          , path: file.path
          , name: file.name
          , mtime: file.stat.mtime
          , hash: contentHash(content)
        };
      },
      'file creation',
      500 // Base delay for file operations
    );
    return result;
  }

  async updateFile(path: string, content: string) {
    // Validate input
    const validationResult = this.validator.validate('file.update', { path, content });
    if (!validationResult.valid) {
      throw new ValidationException(
        validationResult.errors || [],
        `Validation failed for updateFile: ${validationResult.errors?.map(e => e.message).join(', ')}`
      );
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }

    await this.app.vault.modify(file, content);
    // Include `path` so formatFileWrite renders "Updated: <path>" instead of
    // the misleading "Updated: undefined" that masked #210 client-side.
    // mtime and hash are the post-write stat: the caller can echo them back
    // as ifUnmodifiedSince / ifHash on the next edit, chaining writes
    // without re-reading.
    return { success: true, path, mtime: file.stat.mtime, hash: contentHash(content) };
  }

  async deleteFile(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    await this.app.fileManager.trashFile(file);
    return { success: true, path };
  }

  /**
   * Move or rename a file via Obsidian's link-preserving rename.
   *
   * Exists so callers never reach for app.fileManager.renameFile directly: the
   * raw call skips the security layer entirely, which let a `../` destination
   * relocate files outside the vault. SecureObsidianAPI overrides this to
   * validate both path and targetPath.
   *
   * Obsidian uses one primitive for move and rename, and so does this API.
   * The tool surface merged rename into move. A separate rename method would
   * charge a permission that no caller can exercise independently, which is
   * dead config.
   */
  async moveFile(path: string, newPath: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    await this.app.fileManager.renameFile(file, newPath);
    return { success: true, oldPath: path, newPath };
  }

  async appendToFile(path: string, content: string) {
    // Validate input
    const validationResult = this.validator.validate('file.append', { content });
    if (!validationResult.valid) {
      throw new ValidationException(
        validationResult.errors || [],
        `Validation failed for appendToFile: ${validationResult.errors?.map(e => e.message).join(', ')}`
      );
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }

    const existingContent = await this.app.vault.read(file);

    // Validate combined content size
    const combinedValidation = this.validator.validate('file.append', { content: existingContent + content });
    if (!combinedValidation.valid) {
      throw new ValidationException(
        combinedValidation.errors || [],
        `Validation failed: Combined file size would exceed limit`
      );
    }

    await this.app.vault.modify(file, existingContent + content);
    // Post-write stat for write chaining (see updateFile).
    return {
      success: true
      , path
      , mtime: file.stat.mtime
      , hash: contentHash(existingContent + content)
    };
  }

  async patchVaultFile(path: string, params: PatchParams) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }

    let content = await this.app.vault.read(file);

    // Handle structured targeting (heading, block, frontmatter)
    if (params.targetType && params.target) {
      content = this.applyStructuredPatch(content, params);
    }
    // Handle legacy patch operations
    else if (params.operation === 'replace') {
      if (params.old_text && params.new_text) {
        content = content.replace(params.old_text, params.new_text);
      }
    } else if (params.operation === 'insert') {
      if (params.position !== undefined) {
        content = content.slice(0, params.position) + (params.text ?? '') + content.slice(params.position);
      }
    } else if (params.operation === 'delete') {
      if (params.start !== undefined && params.end !== undefined) {
        content = content.slice(0, params.start) + content.slice(params.end);
      }
    }

    await this.app.vault.modify(file, content);
    // Post-write stat for write chaining (see updateFile).
    return {
      success: true
      , updated_content: content
      , mtime: file.stat.mtime
      , hash: contentHash(content)
    };
  }

  private applyStructuredPatch(content: string, params: PatchParams): string {
    const { targetType, target, operation, content: patchContent, value } = params;

    // Without the guard the heading and block switches would silently
    // no-op on an operation they have no case for.
    if (operation === 'remove' && targetType !== 'frontmatter') {
      throw new Error('operation "remove" works on a frontmatter field only');
    }

    switch (targetType) {
      case 'heading':
        return this.patchHeading(content, target ?? '', operation ?? '', patchContent ?? '');
      case 'block':
        return this.patchBlock(content, target ?? '', operation ?? '', patchContent ?? '');
      case 'frontmatter':
        return this.patchFrontmatter(content, target ?? '', operation ?? '', patchContent ?? '', value);
      default:
        throw new Error(`Unknown targetType: ${String(targetType)}`);
    }
  }

  private patchHeading(content: string, headingPath: string, operation: string, patchContent: string): string {
    const lines = content.split('\n');
    const headingHierarchy = headingPath.split('::').map(h => h.trim());
    
    // Find the target heading
    let currentLevel = 0;
    let targetLineIndex = -1;
    let endLineIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();
        
        // Check if we're at the right level in hierarchy
        if (currentLevel < headingHierarchy.length && 
            headingText === headingHierarchy[currentLevel]) {
          currentLevel++;
          
          if (currentLevel === headingHierarchy.length) {
            targetLineIndex = i;
            // Find where this section ends
            for (let j = i + 1; j < lines.length; j++) {
              const nextHeadingMatch = lines[j].match(/^(#{1,6})\s+/);
              if (nextHeadingMatch && nextHeadingMatch[1].length <= level) {
                endLineIndex = j;
                break;
              }
            }
            if (endLineIndex === -1) {
              endLineIndex = lines.length;
            }
            break;
          }
        } else if (level <= currentLevel) {
          // Reset if we've moved to a different section
          currentLevel = 0;
        }
      }
    }
    
    if (targetLineIndex === -1) {
      throw new Error(`Heading not found: ${headingPath}`);
    }
    
    // Apply the operation
    switch (operation) {
      case 'append': {
        // Add content at the end of the section
        // Fix for list continuity - thanks to @that0n3guy (PR #44)
        const lastLine = endLineIndex > 0 ? lines[endLineIndex - 1] : '';
        const isLastLineEmpty = lastLine.trim() === '';
        const listRegex = /^(\s*)([-*+]|\d+\.)\s+/;
        const isPatchList = listRegex.test(patchContent);

        // Find the last non-empty line to check if it's a list
        let lastNonEmptyLine = '';
        for (let i = endLineIndex - 1; i >= targetLineIndex + 1; i--) {
          if (lines[i].trim() !== '') {
            lastNonEmptyLine = lines[i];
            break;
          }
        }
        const isLastNonEmptyLineList = listRegex.test(lastNonEmptyLine);

        if (isLastLineEmpty && isLastNonEmptyLineList && isPatchList) {
          // Preserve list continuity by replacing empty line
          lines.splice(endLineIndex - 1, 1, patchContent);
        } else if (!isLastLineEmpty && isLastNonEmptyLineList && isPatchList) {
          // Append list item without blank line
          lines.splice(endLineIndex, 0, patchContent);
        } else {
          // Default: add blank line separator (original behavior)
          lines.splice(endLineIndex, 0, '', patchContent);
        }
        break;
      }
      case 'prepend':
        // Add content right after the heading
        lines.splice(targetLineIndex + 1, 0, '', patchContent);
        break;
      case 'replace': {
        // Replace the entire section content (keeping the heading)
        const sectionLines = endLineIndex - targetLineIndex - 1;
        lines.splice(targetLineIndex + 1, sectionLines, '', patchContent);
        break;
      }
    }
    
    return lines.join('\n');
  }

  private patchBlock(content: string, blockId: string, operation: string, patchContent: string): string {
    const lines = content.split('\n');
    let blockLineIndex = -1;
    
    // Find the block by ID (blocks end with ^blockId)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().endsWith(`^${blockId}`)) {
        blockLineIndex = i;
        break;
      }
    }
    
    if (blockLineIndex === -1) {
      throw new Error(`Block not found: ^${blockId}`);
    }
    
    // Apply the operation
    switch (operation) {
      case 'append':
        lines[blockLineIndex] = lines[blockLineIndex].replace(`^${blockId}`, `${patchContent} ^${blockId}`);
        break;
      case 'prepend': {
        const blockContent = lines[blockLineIndex].replace(`^${blockId}`, '').trim();
        lines[blockLineIndex] = `${patchContent} ${blockContent} ^${blockId}`;
        break;
      }
      case 'replace':
        lines[blockLineIndex] = `${patchContent} ^${blockId}`;
        break;
    }
    
    return lines.join('\n');
  }

  /**
   * Patch a frontmatter field, field-block aware: the write replaces only
   * the target field's lines (its `field:` line plus its indented lines),
   * so untouched keys stay byte-identical.
   *
   * Two input paths. `value` (any JSON type) serializes through the yaml
   * library, so "true" stays a string and arrays and objects round-trip;
   * it works with operation 'replace' only. The text path keeps the
   * append/prepend/replace string semantics, but the result is serialized
   * as YAML instead of written raw, and append/prepend refuse a field
   * whose current block is multi-line rather than corrupting it.
   */
  private patchFrontmatter(content: string, field: string, operation: string, patchContent: string, value?: unknown): string {
    const lines = content.split('\n');
    let frontmatterStart = -1;
    let frontmatterEnd = -1;

    // Find frontmatter boundaries
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        if (frontmatterStart === -1) {
          frontmatterStart = i;
        } else {
          frontmatterEnd = i;
          break;
        }
      }
    }

    const hasValue = value !== undefined;
    if (hasValue && operation !== 'replace') {
      throw new Error('The value parameter works with operation "replace". Use newText for append and prepend.');
    }

    // Serialize one field assignment. lineWidth 0 never folds long scalars.
    const fieldLines = (val: unknown): string[] =>
      stringify({ [field]: val }, { lineWidth: 0 }).replace(/\n$/, '').split('\n');

    // A missing frontmatter block: every operation but remove creates it.
    if (frontmatterStart === -1) {
      if (operation === 'remove') {
        throw new Error(`Field not found: ${field}`);
      }
      lines.unshift('---', ...(hasValue ? fieldLines(value) : fieldLines(patchContent)), '---', '');
      return lines.join('\n');
    }

    // Find the field block: the `field:` line plus its indented lines.
    let fieldLineIndex = -1;
    for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
      if (lines[i].startsWith(`${field}:`)) {
        fieldLineIndex = i;
        break;
      }
    }

    if (fieldLineIndex === -1) {
      if (operation === 'remove') {
        throw new Error(`Field not found: ${field}`);
      }
      lines.splice(frontmatterEnd, 0, ...(hasValue ? fieldLines(value) : fieldLines(patchContent)));
      return lines.join('\n');
    }

    let fieldEnd = fieldLineIndex + 1;
    while (fieldEnd < frontmatterEnd && (lines[fieldEnd].startsWith(' ') || lines[fieldEnd].startsWith('\t'))) {
      fieldEnd++;
    }

    if (operation === 'remove') {
      lines.splice(fieldLineIndex, fieldEnd - fieldLineIndex);
      return lines.join('\n');
    }

    if (hasValue) {
      lines.splice(fieldLineIndex, fieldEnd - fieldLineIndex, ...fieldLines(value));
      return lines.join('\n');
    }

    const currentValue = lines[fieldLineIndex].substring(field.length + 1).trim();
    if ((operation === 'append' || operation === 'prepend') && fieldEnd > fieldLineIndex + 1) {
      throw new Error(
        `Field ${field} holds a multi-line value (an array or object). Use value with operation "replace" to write it.`
      );
    }

    let combined: string;
    switch (operation) {
      case 'append':
        combined = currentValue ? `${currentValue} ${patchContent}` : patchContent;
        break;
      case 'prepend':
        combined = currentValue ? `${patchContent} ${currentValue}` : patchContent;
        break;
      case 'replace':
        combined = patchContent;
        break;
      default:
        throw new Error(`Unknown frontmatter operation: ${String(operation)}`);
    }
    lines.splice(fieldLineIndex, fieldEnd - fieldLineIndex, ...fieldLines(combined));
    return lines.join('\n');
  }

  /**
   * Check if a file is readable as text (not binary)
   */
  private isTextFile(file: TFile): boolean {
    const textExtensions = new Set([
      'md', 'txt', 'json', 'js', 'ts', 'css', 'html', 'xml', 'yaml', 'yml'
      , 'csv', 'log', 'py', 'java', 'cpp', 'c', 'h', 'php', 'rb', 'go', 'rs'
      , 'sql', 'sh', 'bat', 'ps1', 'ini', 'conf', 'config', 'env'
    ]);
    return textExtensions.has(file.extension.toLowerCase());
  }

  // Search operations

  async searchPaginated(
    query: string,
    page: number = 1,
    pageSize: number = 10,
    strategy: 'filename' | 'content' | 'combined' = 'combined',
    includeContent: boolean = true,
    options?: { ranked?: boolean; includeSnippets?: boolean; snippetLength?: number }
  ): Promise<{
    query: string;
    page: number;
    pageSize: number;
    totalResults: number;
    totalPages: number;
    results: SearchResult[];
    method: string;
    truncated?: boolean;
    originalCount?: number;
    message?: string;
    workflow?: {
      message: string;
      suggested_next: Array<{
        description: string;
        command: string;
        reason: string;
      }>;
    };
  }> {
    // Validate search query
    const validationResult = this.validator.validate('search.query', { query });
    if (!validationResult.valid) {
      throw new ValidationException(
        validationResult.errors || [],
        `Validation failed for search: ${validationResult.errors?.map(e => e.message).join(', ')}`
      );
    }

    // Delegate to SearchFacade for all search operations
    const facadeResponse = await this.searchFacade.searchPaginated(query, {
      page
      , pageSize
      , strategy: strategy as 'filename' | 'content' | 'combined' | 'auto'
      , includeSnippets: options?.includeSnippets ?? includeContent
      , snippetLength: options?.snippetLength
      , ranked: options?.ranked
    });

    // Apply ignore filtering to results (security concern)
    const filteredResults = this.ignoreManager
      ? facadeResponse.results.filter(r => !this.ignoreManager!.isExcluded(r.path))
      : facadeResponse.results;

    // Convert to SearchResult format and build response
    const response: {
      query: string;
      page: number;
      pageSize: number;
      totalResults: number;
      totalPages: number;
      results: SearchResult[];
      method: string;
      workflow?: {
        message: string;
        suggested_next: Array<{
          description: string;
          command: string;
          reason: string;
        }>;
      };
    } = {
      query: facadeResponse.query
      , page: facadeResponse.page
      , pageSize: facadeResponse.pageSize
      , totalResults: facadeResponse.totalResults
      , totalPages: facadeResponse.totalPages
      , results: filteredResults.map(r => ({
        path: r.path
        , title: r.title
        , score: r.score
        , snippet: r.snippet
        , metadata: r.metadata
      }))
      , method: facadeResponse.method
    };

    Debug.log(`Search found ${response.totalResults} results for query: ${query}`);
    if (response.results.length > 0) {
      Debug.log('First few results:', response.results.slice(0, 3).map(r => ({ path: r.path, score: r.score })));
    }

    // Add workflow hints if results were found
    if (response.results.length > 0) {
      const suggestions = [
        {
          description: 'View a specific file'
          , command: 'view:file'
          , reason: 'To see the full content of a file'
        }
        , {
          description: 'Read file fragments'
          , command: 'view:fragments'
          , reason: 'To get relevant excerpts from large files'
        }
        , {
          description: 'Edit a file'
          , command: 'edit:replace'
          , reason: 'To modify content in text files'
        }
      ];

      // Add pagination suggestion only for first few pages
      if (response.page < response.totalPages && response.page <= 3) {
        suggestions.push({
          description: 'Get next page of results'
          , command: 'view:search'
          , reason: `View page ${response.page + 1} of ${response.totalPages} (use page: ${response.page + 1})`
        });
      }

      response.workflow = {
        message: `Found ${response.totalResults} results${response.totalPages > 1 ? ` (page ${response.page} of ${response.totalPages})` : ''}. You can read, view, or edit these files.`
        , suggested_next: suggestions
      };
    }

    return response;
  }

  // Obsidian integration
  async openFile(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    return { success: true };
  }

  getCommands(): Command[] {
    const appInternal = this.app as unknown as AppInternal;
    const commands = appInternal.commands?.commands;
    if (!commands) {
      return [];
    }

    return Object.values(commands).map((cmd: ObsidianCommand) => ({
      id: cmd.id
      , name: cmd.name
      , icon: cmd.icon
    }));
  }

  /**
   * Run an Obsidian command by id.
   *
   * `async` purely so SecureObsidianAPI's override can await validateOperation,
   * keeping a single gate function rather than adding a synchronous entry point
   * that cannot validate paths. Nothing calls this yet — only getCommands() is
   * wired to a tool — so widening the signature costs nothing today.
   *
   * It needs the gate because the command palette contains mutators ("Delete
   * current file", "Move file to…"), making an unguarded executeCommand a write
   * path around the security layer.
   */
  async executeCommand(commandId: string) {
    await Promise.resolve();
    const appInternal = this.app as unknown as AppInternal;
    const success = appInternal.commands?.executeCommandById?.(commandId);
    return {
      success: !!success
      , commandId
    };
  }

  // Helper methods
  private async ensureDirectoryExists(dirPath: string) {
    const parts = dirPath.split('/').filter(part => part);
    let currentPath = '';
    
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(currentPath)) {
        await this.createFolderWithRetry(currentPath);
      }
    }
  }

  private async createFolderWithRetry(folderPath: string): Promise<void> {
    await this.withVaultRetry(
      async () => {
        await this.app.vault.createFolder(folderPath);
      },
      'folder creation',
      300 // Base delay for folder operations
    );
  }

  /**
   * Universal retry mechanism for Vault operations that may conflict with sync processes
   * Handles iCloud Drive, OneDrive, Dropbox, and other sync service timing issues
   * 
   * @param operation - Async function to execute with retry logic
   * @param operationType - Human-readable description for logging
   * @param baseDelayMs - Base delay in milliseconds (exponentially increased per retry)
   * @param maxRetries - Maximum number of retry attempts
   * @returns Result of the operation
   */
  private async withVaultRetry<T>(
    operation: () => Promise<T>,
    operationType: string,
    baseDelayMs: number = 500,
    maxRetries: number = 3
  ): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        // Check if this is a sync-related conflict error
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isSyncConflictError = errorMessage && (
          errorMessage.includes('already exists') ||
          errorMessage.includes('file exists') ||
          errorMessage.includes('folder exists') ||
          errorMessage.includes('EEXIST') ||
          errorMessage.includes('ENOENT') || // File disappeared during sync
          errorMessage.includes('EBUSY') ||  // File locked by sync process
          errorMessage.includes('EPERM')     // Permission denied during sync
        );

        if (isSyncConflictError && attempt < maxRetries - 1) {
          // Exponential backoff: allow time for sync processes to stabilize
          const delay = Math.pow(2, attempt) * baseDelayMs;
          Debug.log(`${operationType} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms... Error: ${errorMessage}`);
          // Backoff delay; window is aliased to globalThis in the Jest node env.
          await new Promise(resolve => window.setTimeout(resolve, delay));
          continue;
        }

        // If it's the final attempt or not a sync-related error, re-throw
        throw error;
      }
    }

    // This should never be reached due to the loop logic, but TypeScript needs it
    throw new Error(`Failed ${operationType} after ${maxRetries} attempts`);
  }

  // ============================================
  // Bases API Methods
  // ============================================

  /**
   * List all bases in the vault
   */
  async listBases(): Promise<Array<{ path: string; name: string; views: string[] }>> {
    return await this.basesAPI.listBases();
  }

  /**
   * Read a base configuration
   */
  async readBase(path: string): Promise<BaseYAML> {
    return await this.basesAPI.readBase(path);
  }

  /**
   * Create a new base
   */
  async createBase(path: string, config: BaseYAML): Promise<void> {
    return await this.basesAPI.createBase(path, config);
  }

  /**
   * Query a base with optional view and caller options
   */
  async queryBase(path: string, viewName?: string, options?: BaseQueryOptions): Promise<BasesQueryResult> {
    return await this.basesAPI.queryBase(path, viewName, options);
  }

  /**
   * Export base data. Runs the same query as queryBase, then serializes.
   */
  async exportBase(path: string, format: 'csv' | 'json' | 'markdown', viewName?: string, options?: BaseQueryOptions): Promise<string> {
    return await this.basesAPI.exportBase(path, format, viewName, options);
  }

}