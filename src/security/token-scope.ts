import { App } from 'obsidian';
import { MCPIgnoreManager } from './mcp-ignore-manager';
import { TokenScope } from './http-auth';

/**
 * An MCPIgnoreManager that additionally hides everything outside a scoped
 * token's folders (ADR-110). The pool builds one per scoped session and hands
 * it to the session's SecureObsidianAPI through the wrapped plugin ref, so
 * every existing ignore-manager call site — validateOperation's PATH_BLOCKED
 * check, listFiles filtering, search-result filtering, graph traversal —
 * enforces the scope with no changes of its own.
 *
 * A path is in scope inside ANY entry's folder; an entry with an empty
 * folder is the whole vault. `isPathReadOnly` answers the write side: a path
 * is writable when some entry containing it is not read-only, so overlapping
 * scopes resolve permissively and a read-only root entry denies everything.
 *
 * The folder predicate runs FIRST and does not depend on the .mcpignore
 * enabled flag: getEnabled() must report true even when the base manager is
 * disabled, because VaultSecurityManager.isPathBlocked gates the exclusion
 * check on it. Without that, a scoped token would still be filtered in
 * enumerations but never blocked on a direct out-of-folder path.
 */
/** Folder containment with both ends normalized: leading and trailing
 * slashes off the scope folder, so 'obsidian://resources/' matches
 * 'obsidian://resources/view'. An empty folder is the whole vault. */
function inScopeFolder(path: string, scope: TokenScope): boolean {
  const folder = (scope.folder ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  return folder === '' || path === folder || path.startsWith(folder + '/');
}

/** The scope folder with both ends' slashes stripped; the empty result is
 * the vault root ("/"). */
function rootFolder(scope: TokenScope): string {
  return (scope.folder ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

export class FolderScopedIgnoreManager extends MCPIgnoreManager {
  constructor(
    app: App,
    private readonly base: MCPIgnoreManager | undefined,
    private readonly scopes: TokenScope[]
  ) {
    super(app);
  }

  /**
   * True unless the path sits inside one of the scope folders. The
   * `folder + '/'` prefix comparison keeps sibling folders with a shared
   * prefix out of scope: "ProjectsX" is not inside "Projects".
   */
  private outsideAllFolders(path: string): boolean {
    const p = path.replace(/^\/+/, '').replace(/\\/g, '/');
    return !this.scopes.some(scope => inScopeFolder(p, scope));
  }

  override isExcluded(path: string): boolean {
    if (this.outsideAllFolders(path)) return true;
    return this.base?.isExcluded(path) ?? false;
  }

  /** True when every scope containing the path is read-only (or none
   * contains it — fail closed). Writable wins on overlap. */
  isPathReadOnly(path?: string): boolean {
    if (path === undefined || path === null) {
      // No path to place: writable only when some scope is a writable root.
      // The root is spelled "/" — the same normalization inScopeFolder
      // applies, where the empty folder matches every path.
      return !this.scopes.some(scope => rootFolder(scope) === '' && scope.readOnly !== true);
    }
    const p = path.replace(/^\/+/, '').replace(/\\/g, '/');
    const containing = this.scopes.filter(scope => inScopeFolder(p, scope));
    if (containing.length === 0) return true;
    return !containing.some(scope => scope.readOnly !== true);
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
      enabled: true
      , patternCount: 0
      , lastModified: 0
      , filePath: ''
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
