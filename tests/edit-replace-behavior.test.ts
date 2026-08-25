import { performWindowEdit } from '../src/tools/window-edit';
import { contentHash } from '../src/utils/content-hash';

// The behavioral contract of edit.replace: exact matching replaces the
// byte-exact span, the canonical retry replaces the quote-class-equal
// span, and fuzzy matching replaces the MATCHED SPAN — never the whole
// line. The caller scoped oldText to a passage; everything outside the
// match is context it did not ask to touch.

function stubApi(initial: string) {
  let content = initial;
  const writes: string[] = [];
  return {
    writes
    , content: () => content
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

describe('edit.replace without fuzzy — the exact path', () => {
  it('replaces the byte-exact span and leaves the rest of the line intact', async () => {
    const { api, writes } = stubApi('The quick brown fox jumps over the lazy dog');
    const res = await performWindowEdit(api, 'note.md', 'quick brown fox', 'slow red panda', 1.0);
    expect(res.isError).toBeUndefined();
    expect(writes).toEqual(['The slow red panda jumps over the lazy dog']);
  });

  it('the default target 1 replaces the single verified occurrence', async () => {
    const { api, writes } = stubApi('one two three four');
    const res = await performWindowEdit(api, 'note.md', 'one two', 'X', 1.0);
    expect(res.isError).toBeUndefined();
    expect(writes).toEqual(['X three four']);
  });

  it('two occurrences without expected refuse with the count in the error', async () => {
    const { api, writes } = stubApi('alpha beta alpha beta');
    const res = await performWindowEdit(api, 'note.md', 'alpha', 'X', 1.0);
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0].text) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('MATCH_COUNT_MISMATCH');
    expect(parsed.error.message).toContain('found 2');
    expect(writes).toEqual([]);
  });

  it('expected above 1 replaces exactly that many occurrences', async () => {
    const { api, writes } = stubApi('alpha beta alpha beta');
    const res = await performWindowEdit(api, 'note.md', 'alpha', 'X', 1.0, 2);
    expect(res.isError).toBeUndefined();
    expect(writes).toEqual(['X beta X beta']);
  });

  it('zero exact occurrences with an explicit expected refuses, nothing written', async () => {
    const { api, writes } = stubApi('unrelated text');
    const res = await performWindowEdit(api, 'note.md', 'alpha', 'X', 1.0, 1);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error.code).toBe('MATCH_COUNT_MISMATCH');
    expect(writes).toEqual([]);
  });
});

describe('edit.replace — the canonical retry (quote classes)', () => {
  it('a quote-class difference matches and splices the span, not the line', async () => {
    const { api, writes } = stubApi('Ligne : l\u2019équipement du donjon est pr\u00eat');
    const res = await performWindowEdit(api, 'note.md', "l'équipement du donjon", 'the equipment', 1.0);
    expect(res.isError).toBeUndefined();
    expect(writes).toEqual(['Ligne : the equipment est pr\u00eat']);
  });
});

describe('edit.replace with fuzzy — the span contract', () => {
  it('a single-character drift replaces the matched span, not the whole line', async () => {
    const { api, writes } = stubApi('The quick brown fox jumps over the lazy dog');
    const res = await performWindowEdit(api, 'note.md', 'quick brwn fox', 'REPLACED');
    expect(res.isError).toBeUndefined();
    // The span 'quick brown fox' becomes REPLACED; prefix and suffix survive.
    expect(writes).toEqual(['The REPLACED jumps over the lazy dog']);
  });

  it('a case-different match (the fuzzy metric is case-insensitive) replaces the span', async () => {
    const { api, writes } = stubApi('The quick brown fox jumps');
    const res = await performWindowEdit(api, 'note.md', 'QUICK BROWN FOX', 'REPLACED');
    expect(res.isError).toBeUndefined();
    expect(writes).toEqual(['The REPLACED jumps']);
  });

  it('a mid-line match keeps both the leading and the trailing context', async () => {
    const { api, writes } = stubApi('prefix alpha betta suffix');
    const res = await performWindowEdit(api, 'note.md', 'alpha beta', 'X');
    expect(res.isError).toBeUndefined();
    expect(writes).toEqual(['prefix X suffix']);
  });

  it('two similar candidate lines refuse with the clarification error, nothing written', async () => {
    const { api, writes } = stubApi('first quick brown line\nsecond quick brown line');
    const res = await performWindowEdit(api, 'note.md', 'quick brwn', 'X');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('2 potential matches');
    expect(writes).toEqual([]);
  });

  it('no match on any pass reports No matches found and writes nothing', async () => {
    const { api, writes } = stubApi('completely different content');
    const res = await performWindowEdit(api, 'note.md', 'quick brwn fox', 'X');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('No matches found');
    expect(writes).toEqual([]);
  });

  it('a multi-line oldText that misses exactly does not fuzz-match across lines', async () => {
    const { api, writes } = stubApi('first line\nsecond line');
    const res = await performWindowEdit(api, 'note.md', 'first line\nsecoond line', 'X');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('No matches found');
    expect(writes).toEqual([]);
  });

  it('exactly one updateFile call carries the whole rewritten content', async () => {
    const { api, writes } = stubApi('The quick brown fox jumps');
    await performWindowEdit(api, 'note.md', 'quick brwn fox', 'REPLACED');
    expect(writes.length).toBe(1);
    expect(writes[0]).toBe('The REPLACED jumps');
  });
});
