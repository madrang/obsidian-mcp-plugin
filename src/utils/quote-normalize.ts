/**
 * Quote-class canonicalization for match comparison.
 *
 * Notes written through the Obsidian editor carry typographic quotes and
 * dashes (Smart punctuation converts them on input), while agent pipelines
 * emit ASCII. An exact `oldText` then misses by invisible characters, and
 * the error renders both spellings identically. Matching runs this
 * canonical form as a fallback so the difference is transparent.
 *
 * The table mirrors `normalizeText` from Defuddle, the text-normalization
 * library bundled inside the Obsidian app, minus its ellipsis rule:
 * everything here is a one-to-one character mapping, so an index in the
 * canonical string is the same index in the original — positions map back
 * without bookkeeping, and the write can splice the original text.
 */
const CANONICAL_RULES: Array<[RegExp, string]> = [
  // Typographic single quotes and primes → ASCII apostrophe
  [/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"]
  // Typographic double quotes and double primes → ASCII quote
  , [/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"']
  // Dash family (figure, en, em, horizontal bar) → ASCII hyphen-minus
  , [/[\u2012\u2013\u2014\u2015]/g, '-']
  // Non-breaking space → space
  , [/\u00A0/g, ' ']
,];

export function canonicalForMatch(text: string): string {
  let out = text;
  for (const [pattern, replacement] of CANONICAL_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Non-overlapping occurrence count of the canonical needle in the
 *  canonical haystack. Same semantics as countOccurrences in window-edit. */
export function countCanonicalOccurrences(content: string, needle: string): number {
  const canonContent = canonicalForMatch(content);
  const canonNeedle = canonicalForMatch(needle);
  if (canonNeedle === '') return 0;
  let count = 0;
  let idx = canonContent.indexOf(canonNeedle);
  while (idx !== -1) {
    count++;
    idx = canonContent.indexOf(canonNeedle, idx + canonNeedle.length);
  }
  return count;
}

/**
 * Replace occurrences of `oldText` in `content`, matching in canonical
 * form and splicing the original at the mapped indices. `count` selects
 * how many occurrences to replace (1 for the default single edit, all for
 * an `expected` above 1). Returns null when there is no canonical match —
 * the caller keeps its no-match error path.
 */
export function replaceCanonical(content: string, oldText: string, newText: string, count: number): string | null {
  const canonContent = canonicalForMatch(content);
  const canonNeedle = canonicalForMatch(oldText);
  if (canonNeedle === '') return null;

  const indices: number[] = [];
  let idx = canonContent.indexOf(canonNeedle);
  while (idx !== -1) {
    indices.push(idx);
    idx = canonContent.indexOf(canonNeedle, idx + canonNeedle.length);
  }
  if (indices.length === 0) return null;

  // The mapping is one-to-one, so a canonical index is an original index,
  // and the canonical needle length is the original span length. Splice
  // from the end so earlier indices stay valid.
  const span = oldText.length;
  const take = count >= indices.length ? indices.length : count;
  let out = content;
  for (let i = take - 1; i >= 0; i--) {
    const at = indices[i];
    out = out.slice(0, at) + newText + out.slice(at + span);
  }
  return out;
}
