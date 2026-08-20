import { App } from 'obsidian';
import { MCPIgnoreManager } from './mcp-ignore-manager';

/**
 * An MCPIgnoreManager that additionally hides everything outside one vault
 * folder (ADR-110). The pool builds one per folder-scoped session and hands it
 * to the session's SecureObsidianAPI through the wrapped plugin ref, so every
 * existing ignore-manager call site — validateOperation's PATH_BLOCKED check,
 * listFiles filtering, search-result filtering, graph traversal — enforces the
 * scope with no changes of its own.
 *
 * The folder predicate runs FIRST and does not depend on the .mcpignore
 * enabled flag: getEnabled() must report true even when the base manager is
 * disabled, because VaultSecurityManager.isPathBlocked gates the exclusion
 * check on it. Without that, a scoped token would still be filtered in
 * enumerations but never blocked on a direct out-of-folder path.
 */
export class FolderScopedIgnoreManager extends MCPIgnoreManager {
  constructor(
    app: App,
    private readonly base: MCPIgnoreManager | undefined,
    private readonly folder: string
  ) {
    super(app);
  }

  /**
   * True for any path that is not the folder itself or inside it. The
   * `folder + '/'` prefix comparison keeps sibling folders with a shared
   * prefix out of scope: "ProjectsX" is not inside "Projects".
   */
  private outsideFolder(path: string): boolean {
    const p = path.replace(/^\/+/, '').replace(/\\/g, '/');
    return p !== this.folder && !p.startsWith(this.folder + '/');
  }

  override isExcluded(path: string): boolean {
    if (this.outsideFolder(path)) return true;
    return this.base?.isExcluded(path) ?? false;
  }

  override filterPaths(paths: string[]): string[] {
    return paths.filter(path => !this.isExcluded(path));
  }

  /** Always on: the folder scope applies even when .mcpignore is disabled. */
  override getEnabled(): boolean {
    return true;
  }

  override getPatterns(): string[] {
    return this.base?.getPatterns() ?? [];
  }

  override getStats(): { enabled: boolean; patternCount: number; lastModified: number; filePath: string } {
    return this.base?.getStats() ?? {
      enabled: true,
      patternCount: 0,
      lastModified: 0,
      filePath: ''
    };
  }

  override async loadIgnoreFile(): Promise<void> {
    await this.base?.loadIgnoreFile();
  }

  override async forceReload(): Promise<void> {
    await this.base?.forceReload();
  }

  override setEnabled(enabled: boolean): void {
    this.base?.setEnabled(enabled);
  }
}
