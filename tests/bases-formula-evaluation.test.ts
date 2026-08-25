/**
 * Formula evaluation in bases.query.
 *
 * The formula value in a `.base` file is the expression string itself
 * (native `formulas: Record<string, string>`). A nested `name: {formula:
 * ...}` shape used to hand an object to the engine, which cannot parse and
 * degraded every formula to a silent null. These pins hold: the nested
 * shape fails the query with the key named, `if()` evaluates in the flat
 * shape, and a string-literal formula carries its own quotes inside the
 * YAML value.
 */
import { App, TFile } from 'obsidian';

jest.mock('obsidian', () => ({
  ...jest.requireActual('obsidian'),
  getAllTags: (cache: any) => cache?.tags ?? [],
}));

import { BasesAPI } from '../src/utils/bases-api';

function mk(p: string, content: string): TFile {
  const f = new TFile();
  Object.assign(f, {
    path: p, name: p, extension: p.split('.').pop(), basename: p.replace(/\.\w+$/, ''),
    stat: { size: content.length, mtime: 1, ctime: 1 },
    parent: { path: '' },
    __content: content, __tags: [],
  });
  return f as never;
}

function makeApp(baseYaml: string): App {
  const note = mk('note.md', 'body');
  const base = mk('probe.base', baseYaml);
  const files = [note, base];
  return {
    vault: {
      getAbstractFileByPath: (p: string) => files.find(f => f.path === p) ?? null,
      getMarkdownFiles: () => [note],
      read: async (f: any) => f.__content,
      cachedRead: async (f: any) => f.__content,
    },
    metadataCache: {
      getFileCache: (f: any) => ({ frontmatter: {}, tags: f.__tags }),
      trigger: () => {},
    },
  } as unknown as App;
}

async function queryFormulas(baseYaml: string): Promise<Record<string, unknown>> {
  const api = new BasesAPI(makeApp(baseYaml) as never);
  return (await api.queryBase('probe.base')).notes[0].formulas!;
}

describe('bases formula evaluation', () => {
  it('if() evaluates in the native flat shape', async () => {
    const formulas = await queryFormulas(
      'formulas:\n  testIf: if(file.ext == "md", "IF-VIVANT", "IF-MORT")\nviews:\n  - type: table\n    name: main');
    expect(formulas.testIf).toBe('IF-VIVANT');
  });

  it('a string-literal formula carries its own quotes inside the YAML value', async () => {
    const formulas = await queryFormulas(
      "formulas:\n  testLit: '\"LIT-VIVANT\"'\nviews:\n  - type: table\n    name: main");
    expect(formulas.testLit).toBe('LIT-VIVANT');
  });

  it('an unquoted word pair is subtraction, not a literal', async () => {
    const formulas = await queryFormulas(
      'formulas:\n  testLit: "LIT-VIVANT"\nviews:\n  - type: table\n    name: main');
    // The formula was parsed as LIT minus VIVANT, two unknown identifiers.
    // The NaN detector refuses that arithmetic and the formula catch maps
    // the refusal to null — the documented formula-error result, and what
    // JSON showed for NaN anyway.
    expect(formulas.testLit).toBeNull();
  });

  it('the nested formula shape fails the query with the key named', async () => {
    await expect(queryFormulas(
      'formulas:\n  testIf:\n    formula: if(file.ext == "md", "a", "b")\nviews:\n  - type: table\n    name: main'))
      .rejects.toThrow('Formula "testIf" must be a string expression');
  });
});
