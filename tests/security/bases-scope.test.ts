/**
 * ADR-110 scope enforcement for the bases tool. bases.list used to enumerate
 * every .base file in the vault, and bases.read/query/export never validated
 * their path — a folder-scoped token could list out-of-scope bases, read their
 * configs, and evaluate them over every note in the vault. The fix runs on two
 * layers: BasesAPI receives the caller's ignore manager (folder scope plus
 * .mcpignore filter the enumeration and the note set), and SecureObsidianAPI
 * charges readBase/queryBase/exportBase as READ through validateOperation.
 *
 * Assertions are on recorded results and error codes, not error strings.
 */
import { BasesAPI } from '../../src/utils/bases-api';
import { SecureObsidianAPI } from '../../src/security/secure-obsidian-api';
import { FolderScopedIgnoreManager } from '../../src/security/token-scope';
import { App, TFile } from 'obsidian';

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop()!;
  f.basename = f.name.replace(/\.[^.]+$/, '');
  f.extension = path.split('.').pop()!;
  (f as unknown as { stat: unknown }).stat = { ctime: 0, mtime: 0, size: 10 };
  return f;
}

const FILES = new Map<string, TFile>([
  ['Projects/dash.base', makeFile('Projects/dash.base')],
  ['Secret/other.base', makeFile('Secret/other.base')],
  ['Projects/in-scope.md', makeFile('Projects/in-scope.md')],
  ['Secret/out-of-scope.md', makeFile('Secret/out-of-scope.md')],
]);

const CONTENT = new Map<string, string>([
  ['Projects/dash.base', 'views:\n  - name: main\n'],
  ['Secret/other.base', 'views:\n  - name: hidden\n'],
  ['Projects/in-scope.md', '# in scope\n'],
  ['Secret/out-of-scope.md', '# out of scope\n'],
]);

function makeApp(): App {
  return {
    vault: {
      adapter: { basePath: '/test/vault' },
      getFiles: () => [...FILES.values()],
      getMarkdownFiles: () => [...FILES.values()].filter(f => f.extension === 'md'),
      getAbstractFileByPath: (p: string) => FILES.get(p) ?? null,
      read: async (f: TFile) => CONTENT.get(f.path) ?? '',
    },
    metadataCache: {
      getFileCache: () => null,
      trigger: () => undefined,
      resolvedLinks: {},
    },
  } as unknown as App;
}

const PERMISSIVE = {
  pathValidation: 'strict' as const,
  permissions: { read: true, create: true, update: true, delete: true, move: true, execute: true },
  blockedPaths: [],
  logSecurityEvents: false,
};

describe('BasesAPI scoped by the ignore manager (ADR-110)', () => {
  const scoped = () => new FolderScopedIgnoreManager(makeApp(), undefined, [{ folder: 'Projects' }]);

  test('listBases returns only in-scope bases for a folder-scoped manager', async () => {
    const api = new BasesAPI(makeApp(), scoped());
    const bases = await api.listBases();
    expect(bases.map(b => b.path)).toEqual(['Projects/dash.base']);
  });

  test('listBases without a manager returns everything (unscoped callers)', async () => {
    const api = new BasesAPI(makeApp());
    const bases = await api.listBases();
    expect(bases.map(b => b.path).sort()).toEqual(['Projects/dash.base', 'Secret/other.base']);
  });

  test('queryBase evaluates only in-scope notes, even with no filters', async () => {
    const api = new BasesAPI(makeApp(), scoped());
    const result = await api.queryBase('Projects/dash.base');
    const paths = result.notes.map((n: { file?: { path?: string }; path?: string }) => n.file?.path ?? n.path);
    expect(paths).toContain('Projects/in-scope.md');
    expect(paths).not.toContain('Secret/out-of-scope.md');
  });
});

describe('SecureObsidianAPI charges bases reads (ADR-110)', () => {
  function scopedAPI(): SecureObsidianAPI {
    return new SecureObsidianAPI(
      makeApp(),
      undefined,
      { ignoreManager: new FolderScopedIgnoreManager(makeApp(), undefined, [{ folder: 'Projects' }]) },
      PERMISSIVE
    );
  }

  test('readBase on an out-of-scope base is PATH_BLOCKED', async () => {
    await expect(scopedAPI().readBase('Secret/other.base')).rejects.toMatchObject({
      code: 'PATH_BLOCKED',
    });
  });

  test('queryBase on an out-of-scope base is PATH_BLOCKED', async () => {
    await expect(scopedAPI().queryBase('Secret/other.base')).rejects.toMatchObject({
      code: 'PATH_BLOCKED',
    });
  });

  test('exportBase on an out-of-scope base is PATH_BLOCKED', async () => {
    await expect(scopedAPI().exportBase('Secret/other.base', 'json')).rejects.toMatchObject({
      code: 'PATH_BLOCKED',
    });
  });

  test('readBase inside the scope passes the gate', async () => {
    const config = await scopedAPI().readBase('Projects/dash.base');
    expect(config.views?.[0]?.name).toBe('main');
  });
});
