/**
 * Base file filter forms.
 *
 * Three failures shipped together: a list-form `filters:` key never ran
 * (the array fell through evaluateFilter's operator checks to `true`), a
 * `not:`/`and:`/`or:` operand written as a plain string was iterated
 * character by character, and a native method call such as
 * `file.tags.isEmpty()` evaluated to a silent falsy. These pins hold the
 * corrected behavior: list form applies per item, string operands coerce,
 * member calls dispatch through the native table, and an unsupported
 * native spelling fails the query with the cause.
 */
import { App, TFile } from 'obsidian';

jest.mock('obsidian', () => ({
  ...jest.requireActual('obsidian'),
  getAllTags: (cache: any) => cache?.tags ?? [],
}));

import { BasesAPI } from '../src/utils/bases-api';
import { ExpressionEvaluator } from '../src/utils/expression-evaluator';

function mk(p: string, content: string, tags?: string[]): TFile {
  const f = new TFile();
  Object.assign(f, {
    path: p, name: p, extension: p.split('.').pop(), basename: p.replace(/\.\w+$/, ''),
    stat: { size: content.length, mtime: 1, ctime: 1 },
    parent: { path: p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '' },
    __content: content, __tags: tags ?? [],
  });
  return f as never;
}

function makeApp(baseYaml: string) {
  const files = [
    mk('tagged.md', 'x', ['#a']),
    mk('untagged.md', 'y', []),
    mk('other.md', 'z', ['#b']),
    mk('probe.base', baseYaml, []),
  ];
  return {
    app: {
      vault: {
        getAbstractFileByPath: (p: string) => files.find(f => f.path === p) ?? null,
        getMarkdownFiles: () => files.filter(f => f.extension === 'md'),
        read: async (f: any) => f.__content,
        cachedRead: async (f: any) => f.__content,
      },
      metadataCache: {
        getFileCache: (f: any) => ({ frontmatter: {}, tags: f.__tags }),
        trigger: () => {},
      },
    } as unknown as App,
    files,
  };
}

async function queryPaths(baseYaml: string): Promise<string[]> {
  const { app } = makeApp(baseYaml);
  const api = new BasesAPI(app as never);
  return (await api.queryBase('probe.base')).notes.map((n: any) => n.path);
}

describe('Bases filter forms', () => {
  describe('list form applies per item', () => {
    it('each list filter must pass', async () => {
      const paths = await queryPaths("filters:\n  - file.tags.isEmpty()\nviews:\n  - type: table\n    name: main");
      expect(paths).toEqual(['untagged.md']);
    });

    it('multiple list items compose with and', async () => {
      const paths = await queryPaths(
        "filters:\n  - file.tags.isEmpty()\n  - file.name == \"tagged\"\nviews:\n  - type: table\n    name: main");
      expect(paths).toEqual([]);
    });
  });

  describe('logical operators coerce a string operand', () => {
    it('not with a string operand negates the expression once', async () => {
      const paths = await queryPaths(
        'filters:\n  - not: "file.tags.isEmpty()"\nviews:\n  - type: table\n    name: main');
      expect(paths.sort()).toEqual(['other.md', 'tagged.md']);
    });

    it('and with string operands applies every operand', async () => {
      const paths = await queryPaths(
        'filters:\n  - and:\n      - "file.tags.isEmpty()"\n      - "file.name == \\"untagged\\""\nviews:\n  - type: table\n    name: main');
      expect(paths).toEqual(['untagged.md']);
    });
  });

  describe('native method calls on values', () => {
    const evaluator = () => {
      const { app } = makeApp('');
      return new ExpressionEvaluator(app);
    };
    const noteContext = (tags: string[]) => ({
      file: mk('n.md', 'x', tags),
      cache: { frontmatter: {}, tags },
      frontmatter: {},
      formulas: {},
    }) as never;

    it('file.tags.isEmpty() is true for no tags, false for tags', () => {
      const ev = evaluator();
      expect(ev.evaluateStrict('file.tags.isEmpty()', noteContext([]))).toBe(true);
      expect(ev.evaluateStrict('file.tags.isEmpty()', noteContext(['#a']))).toBe(false);
    });

    it('string, number, and object isEmpty follow the native table', () => {
      const ev = evaluator();
      // jsep rejects member access on a bare string literal, so the string
      // receiver rides a property, the way real filters write it.
      expect(ev.evaluateStrict('file.name.isEmpty()', noteContext([]))).toBe(false);
      expect(ev.evaluateStrict('file.size.isEmpty()', noteContext([]))).toBe(false);
      expect(ev.evaluateStrict('note.isEmpty()', noteContext([]))).toBe(true);
    });

    it('file.hasTag still works through the own-property path', () => {
      const ev = evaluator();
      expect(ev.evaluateStrict('file.hasTag("a")', noteContext(['#a']))).toBe(true);
      expect(ev.evaluateStrict('file.hasTag("a")', noteContext(['#b']))).toBe(false);
    });

    it('an unsupported method fails the query with the cause', async () => {
      await expect(queryPaths(
        'filters:\n  - file.tags.join(",")\nviews:\n  - type: table\n    name: main'))
        .rejects.toThrow('Unknown function "join"');
    });
  });

  it('a plain single-string filter still applies', async () => {
    const paths = await queryPaths('filters: "file.tags.isEmpty()"\nviews:\n  - type: table\n    name: main');
    expect(paths).toEqual(['untagged.md']);
  });

  describe('a NaN result fails the query', () => {
    it('date-duration arithmetic (the Stale notes filter) refuses instead of emptying', async () => {
      await expect(queryPaths(
        'filters:\n  - \'file.mtime < now() - "90d"\'\nviews:\n  - type: table\n    name: main'))
        .rejects.toThrow('NaN');
    });

    it('any NaN-producing comparison refuses', async () => {
      await expect(queryPaths(
        'filters:\n  - "file.size * note.nonexistent > 10"\nviews:\n  - type: table\n    name: main'))
        .rejects.toThrow('Filter error');
    });

    it('numeric comparisons that resolve keep working', async () => {
      const paths = await queryPaths(
        'filters:\n  - "file.size > 0"\nviews:\n  - type: table\n    name: main');
      expect(paths.sort()).toEqual(['other.md', 'tagged.md', 'untagged.md']);
    });
  });
});
