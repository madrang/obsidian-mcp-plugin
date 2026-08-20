/**
 * FolderScopedIgnoreManager (ADR-110): the composite that hides everything
 * outside a scoped token's folder. It sits in the ignore-manager slot of a
 * session's SecureObsidianAPI, so these semantics ARE the folder restriction —
 * a wrong answer here is a cross-token disclosure.
 */
import { App } from 'obsidian';
import { FolderScopedIgnoreManager } from '../../src/security/token-scope';
import { MCPIgnoreManager } from '../../src/security/mcp-ignore-manager';

jest.mock('obsidian');

function makeApp(): App {
  return {
    vault: { adapter: {} },
  } as unknown as App;
}

describe('FolderScopedIgnoreManager', () => {
  const app = makeApp();

  it('excludes everything outside the folder', () => {
    const m = new FolderScopedIgnoreManager(app, undefined, 'Projects/Blog');
    for (const p of ['Notes/a.md', 'secret.md', 'Projects/Other/x.md', '.mcpignore']) {
      expect(m.isExcluded(p)).toBe(true);
    }
  });

  it('includes the folder itself and everything under it', () => {
    const m = new FolderScopedIgnoreManager(app, undefined, 'Projects/Blog');
    for (const p of ['Projects/Blog', 'Projects/Blog/post.md', 'Projects/Blog/assets/img.png']) {
      expect(m.isExcluded(p)).toBe(false);
    }
  });

  it('does not over-match a sibling folder that shares a prefix', () => {
    // 'Projects' + startsWith would also match 'ProjectsX' without the
    // trailing-separator comparison.
    const m = new FolderScopedIgnoreManager(app, undefined, 'Projects');
    expect(m.isExcluded('ProjectsX/secret.md')).toBe(true);
    expect(m.isExcluded('ProjectsX')).toBe(true);
    expect(m.isExcluded('Projects/ok.md')).toBe(false);
  });

  it('normalizes leading slashes and backslashes before comparing', () => {
    const m = new FolderScopedIgnoreManager(app, undefined, 'Projects/Blog');
    expect(m.isExcluded('/Projects/Blog/post.md')).toBe(false);
    expect(m.isExcluded('Projects\\Blog\\post.md')).toBe(false);
    expect(m.isExcluded('/Notes/a.md')).toBe(true);
  });

  it('filters path lists', () => {
    const m = new FolderScopedIgnoreManager(app, undefined, 'Projects');
    expect(m.filterPaths(['Projects/a.md', 'Notes/b.md', 'Projects/sub/c.md']))
      .toEqual(['Projects/a.md', 'Projects/sub/c.md']);
  });

  it('reports enabled even with no base manager, so isPathBlocked consults it', () => {
    // VaultSecurityManager.isPathBlocked gates the exclusion check on
    // getEnabled(); a scope that only filtered enumerations but never blocked
    // a direct path would be a hole.
    const m = new FolderScopedIgnoreManager(app, undefined, 'Projects');
    expect(m.getEnabled()).toBe(true);
  });

  it('still applies the base manager inside the folder', async () => {
    // A real .mcpignore read: the adapter serves one exclusion pattern, which
    // the base manager loads through its normal path.
    const appWithIgnore = {
      vault: {
        adapter: {
          stat: async () => ({ mtime: 1 }),
          read: async () => 'Projects/Blog/draft.md\n',
        },
      },
    } as unknown as App;
    const base = new MCPIgnoreManager(appWithIgnore);
    base.setEnabled(true);
    await new Promise(resolve => setTimeout(resolve, 0)); // let loadIgnoreFile finish

    const m = new FolderScopedIgnoreManager(appWithIgnore, base, 'Projects/Blog');
    expect(m.isExcluded('Projects/Blog/draft.md')).toBe(true);
    expect(m.isExcluded('Projects/Blog/post.md')).toBe(false);
    expect(m.isExcluded('Notes/a.md')).toBe(true);
  });

  it('keeps the scope active when the base manager is disabled', () => {
    const base = new MCPIgnoreManager(app);
    base.setEnabled(false);

    const m = new FolderScopedIgnoreManager(app, base, 'Projects');
    expect(m.getEnabled()).toBe(true);
    expect(m.isExcluded('Notes/a.md')).toBe(true);
    expect(m.isExcluded('Projects/a.md')).toBe(false);
  });
});
