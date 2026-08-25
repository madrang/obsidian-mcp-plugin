import { performWindowEdit } from '../src/tools/window-edit';
import { canonicalForMatch, countCanonicalOccurrences, replaceCanonical } from '../src/utils/quote-normalize';
import { contentHash } from '../src/utils/content-hash';

// A note with an ASCII line and a typographic line: edit.replace at
// fuzzyThreshold 1.0 across the quote class fails with "No matches found"
// — the error renders both spellings identically — and the default-fuzzy
// recovery rewrites the entire line. The canonical pass matches across
// the quote classes and splices only the matched span, so the tolerance
// is transparent.

const TYPO = 'l\u2019équipement du donjon';
const ASCII = "l'équipement du donjon";

function stubApi(initial: string) {
  let content = initial;
  const writes: string[] = [];
  return {
    writes
    , api: {
      getFile: async () => ({ path: 'note.md', content }),
      updateFile: async (_path: string, newContent: string) => {
        writes.push(newContent);
        content = newContent;
        return { success: true, mtime: 2, hash: contentHash(newContent) };
      },
    } as never,
  };
}

describe('canonicalForMatch', () => {
  it('maps every quote-class member to its ASCII form, preserving length', () => {
    expect(canonicalForMatch('\u2018\u2019\u201A\u201B\u2032\u2035')).toBe("''''''");
    expect(canonicalForMatch('\u201C\u201D\u201E\u201F\u2033\u2036')).toBe('""""""');
    expect(canonicalForMatch('\u2012\u2013\u2014\u2015')).toBe('----');
    expect(canonicalForMatch('a\u00A0b')).toBe('a b');
    expect(canonicalForMatch(TYPO)).toBe(ASCII);
    expect(canonicalForMatch(TYPO).length).toBe(TYPO.length);
  });

  it('leaves plain text untouched', () => {
    expect(canonicalForMatch(ASCII)).toBe(ASCII);
  });
});

describe('countCanonicalOccurrences / replaceCanonical', () => {
  it('counts across the class and splices only the matched span', () => {
    const content = `x ${TYPO} y ${TYPO} z`;
    expect(countCanonicalOccurrences(content, ASCII)).toBe(2);
    expect(replaceCanonical(content, ASCII, 'REPL', 1)).toBe(`x REPL y ${TYPO} z`);
    expect(replaceCanonical(content, ASCII, 'REPL', 2)).toBe('x REPL y REPL z');
  });

  it('works in the reverse direction: typographic needle, ASCII file', () => {
    expect(replaceCanonical(ASCII, TYPO, 'REPL', 1)).toBe('REPL');
  });

  it('returns null when neither class matches', () => {
    expect(replaceCanonical('abc', 'xyz', 'R', 1)).toBeNull();
  });
});

describe('performWindowEdit — quote-style tolerant matching', () => {
  it('an exact miss falls back to a canonical match and splices the span', async () => {
    const { api, writes } = stubApi(`Ligne B : ${TYPO}`);
    const res = await performWindowEdit(api, 'note.md', ASCII, 'REPLACED', 1.0);
    expect(res.isError).toBeUndefined();
    expect(writes[0]).toBe('Ligne B : REPLACED');
    expect(res.content[0].text).toContain('quote-style tolerant');
  });

  it('the count guard applies to the canonical count', async () => {
    const { api, writes } = stubApi(`${TYPO} and ${TYPO}`);
    const res = await performWindowEdit(api, 'note.md', ASCII, 'R', 1.0);
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0].text) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('MATCH_COUNT_MISMATCH');
    expect(parsed.error.message).toContain('found 2');
    expect(writes).toEqual([]);
  });

  it('expected above 1 replaces all canonical occurrences like the exact path', async () => {
    const { api, writes } = stubApi(`${TYPO} and ${TYPO}`);
    const res = await performWindowEdit(api, 'note.md', ASCII, 'R', 1.0, 2);
    expect(res.isError).toBeUndefined();
    expect(writes[0]).toBe('R and R');
  });

  it('a miss on both passes still reaches the no-match error', async () => {
    const { api } = stubApi(ASCII);
    const res = await performWindowEdit(api, 'note.md', 'absent', 'R', 1.0);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('No matches found');
  });

  it('an exact match never takes the canonical path', async () => {
    const { api, writes } = stubApi(ASCII);
    const res = await performWindowEdit(api, 'note.md', ASCII, 'R', 1.0);
    expect(res.content[0].text).toContain('(exact)');
    expect(writes[0]).toBe('R');
  });
});
