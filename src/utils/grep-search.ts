/** One regex match found by the view.grep scan. Line and column are 1-based. */
export interface GrepMatch {
  path: string;
  line: number;
  column: number;
  /** The full matching line, verbatim */
  text: string;
}

/**
 * Scan one file's content for every regex match, in line order, returning at
 * most `limit` matches. The regex must carry the global flag. This is the
 * count-first half of a count-guarded edit.replace: the number of matches a
 * grep returns is the `expected` value the replace accepts.
 */
export function grepContent(path: string, content: string, regex: RegExp, limit: number): GrepMatch[] {
  const matches: GrepMatch[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    for (const m of lines[i].matchAll(regex)) {
      if (m.index === undefined) continue;
      matches.push({ path, line: i + 1, column: m.index + 1, text: lines[i] });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
