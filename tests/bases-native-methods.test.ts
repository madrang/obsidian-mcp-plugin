/**
 * Filter value methods in Bases expressions.
 *
 * The method surface is deliberately bounded to what a filter predicate
 * can use — the expression spellings of the structured filter operator
 * vocabulary (contains, in, starts_with, ends_with, is_empty). The
 * boundary pins below hold that line: transforms, formatting, number and
 * date methods are formula territory and must stay unsupported, failing
 * the query loudly rather than creeping in.
 */
import { App, TFile } from 'obsidian';

jest.mock('obsidian', () => ({
  ...jest.requireActual('obsidian'),
  getAllTags: (cache: any) => cache?.tags ?? [],
}));

import { ExpressionEvaluator } from '../src/utils/expression-evaluator';

function mk(p: string, content: string, tags?: string[]): TFile {
  const f = new TFile();
  Object.assign(f, {
    path: p, name: p, extension: p.split('.').pop(), basename: p.replace(/\.\w+$/, ''),
    stat: { size: content.length, mtime: 1, ctime: 1 },
    parent: { path: '' },
    __content: content, __tags: tags ?? [],
  });
  return f as never;
}

const app = {
  vault: {},
  metadataCache: { getFileCache: () => ({}), trigger: () => {} },
} as unknown as App;

function noteContext(frontmatter: Record<string, unknown>, tags: string[] = []) {
  return {
    file: mk('n.md', 'x', tags),
    cache: { frontmatter, tags },
    frontmatter,
    formulas: {},
  } as never;
}

describe('filter value methods', () => {
  const ev = new ExpressionEvaluator(app);
  const ctx = noteContext(
    { status: 'Active Project', slug: 'a-b-c', tasks: [3, 1, 2], tags: ['alpha', 'beta'] },
    ['#filetag'],
  );

  describe('string membership and bounds', () => {
    it('contains, containsAll, containsAny', () => {
      expect(ev.evaluateStrict('status.contains("Active")', ctx)).toBe(true);
      expect(ev.evaluateStrict('status.contains("zzz")', ctx)).toBe(false);
      expect(ev.evaluateStrict('status.containsAll("Active", "Proj")', ctx)).toBe(true);
      expect(ev.evaluateStrict('status.containsAll("Active", "zzz")', ctx)).toBe(false);
      expect(ev.evaluateStrict('status.containsAny("zzz", "Proj")', ctx)).toBe(true);
      expect(ev.evaluateStrict('status.containsAny("zzz", "yyy")', ctx)).toBe(false);
    });

    it('startsWith and endsWith', () => {
      expect(ev.evaluateStrict('status.startsWith("Active")', ctx)).toBe(true);
      expect(ev.evaluateStrict('status.startsWith("Project")', ctx)).toBe(false);
      expect(ev.evaluateStrict('status.endsWith("Project")', ctx)).toBe(true);
    });
  });

  describe('list membership', () => {
    it('contains, containsAll, containsAny', () => {
      expect(ev.evaluateStrict('tasks.contains(2)', ctx)).toBe(true);
      expect(ev.evaluateStrict('tasks.contains(9)', ctx)).toBe(false);
      expect(ev.evaluateStrict('tasks.containsAll(1, 2)', ctx)).toBe(true);
      expect(ev.evaluateStrict('tasks.containsAll(1, 9)', ctx)).toBe(false);
      expect(ev.evaluateStrict('tasks.containsAny(9, 2)', ctx)).toBe(true);
    });

    it('file.tags carries the same membership methods', () => {
      expect(ev.evaluateStrict('file.tags.contains("#filetag")', ctx)).toBe(true);
      expect(ev.evaluateStrict('file.tags.contains("#nope")', ctx)).toBe(false);
    });
  });

  describe('the boundary — formula methods stay unsupported', () => {
    it('string transforms and formatting throw', () => {
      expect(() => ev.evaluateStrict('status.title()', ctx)).toThrow('Unknown function "title"');
      expect(() => ev.evaluateStrict('status.lower()', ctx)).toThrow('Unknown function "lower"');
      expect(() => ev.evaluateStrict('slug.split("-")', ctx)).toThrow('Unknown function "split"');
      expect(() => ev.evaluateStrict('slug.replace("-", "+")', ctx)).toThrow('Unknown function "replace"');
    });

    it('list transforms throw', () => {
      expect(() => ev.evaluateStrict('tasks.join(",")', ctx)).toThrow('Unknown function "join"');
      expect(() => ev.evaluateStrict('tasks.sort()', ctx)).toThrow('Unknown function "sort"');
      expect(() => ev.evaluateStrict('tasks.unique()', ctx)).toThrow('Unknown function "unique"');
    });

    it('number, date, and object methods throw', () => {
      expect(() => ev.evaluateStrict('file.size.abs()', ctx)).toThrow('Unknown function "abs"');
      expect(() => ev.evaluateStrict('file.mtime.format("YYYY")', ctx)).toThrow('Unknown function "format"');
      expect(() => ev.evaluateStrict('note.keys()', ctx)).toThrow('Unknown function "keys"');
    });

    it('the any-group introspection methods throw', () => {
      expect(() => ev.evaluateStrict('status.isType("string")', ctx)).toThrow('Unknown function "isType"');
      expect(() => ev.evaluateStrict('status.toString()', ctx)).toThrow('Unknown function "toString"');
    });
  });
});
