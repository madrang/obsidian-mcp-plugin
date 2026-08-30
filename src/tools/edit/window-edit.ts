import { ObsidianAPI } from '../../utils/obsidian-api';
import { findFuzzyMatches } from '../../utils/fuzzy-match';
import { countCanonicalOccurrences, replaceCanonical } from '../../utils/quote-normalize';
import { ContentBufferManager } from '../../utils/content-buffer';
import { isImageFile } from '../../types/obsidian';

// Shared edit logic behind edit.replace, imported
// dynamically by the router to avoid circular references.

/** Non-overlapping occurrence count — the same semantics split/join replace
 * uses, so the count always equals the number of replacements a write does. */
function countOccurrences(content: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let idx = content.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = content.indexOf(needle, idx + needle.length);
  }
  return count;
}

export async function performWindowEdit(
  api: ObsidianAPI,
  path: string,
  oldText: string,
  newText: string,
  fuzzyThreshold: number = 0.7,
  expected?: number
) {
  if (expected !== undefined && (!Number.isInteger(expected) || expected < 1)) {
    throw new Error(`edit.replace: 'expected' must be a whole number of at least 1.`);
  }

  const buffer = ContentBufferManager.getInstance();

  // Get current file content
  const file = await api.getFile(path);
  if (isImageFile(file)) {
    throw new Error('Cannot perform window edits on image files');
  }
  const content = typeof file === 'string' ? file : file.content;

  // Exact path, count-guarded. `expected` is both the guard and the selector:
  // the default 1 replaces the single verified occurrence, N above 1 replaces
  // all N. An explicit `expected` refuses on ANY deviation from the count the
  // caller verified (via view.grep or a complete read) — including zero.
  // When the byte-exact needle misses, one retry runs in the canonical
  // quote-class form (typographic vs ASCII quotes and dashes, nbsp):
  // editor-written notes and agent-emitted oldText differ by invisible
  // characters. The canonical pass keeps the count guard and splices the
  // original text, so it never rewrites what it did not match. An omitted
  // `expected` with zero matches on both passes falls through to fuzzy,
  // the legacy recovery path.
  const count = countOccurrences(content, oldText);
  const canonical = count === 0;
  const matchCount = canonical ? countCanonicalOccurrences(content, oldText) : count;
  if (matchCount > 0 || expected !== undefined) {
    const target = expected ?? 1;
    if (matchCount !== target) {
      buffer.store(newText, undefined, {
        filePath: path
        , searchText: oldText
      });
      return {
        content: [{
          type: 'text'
          , text: JSON.stringify({
            error: {
              code: 'MATCH_COUNT_MISMATCH'
              , message:
                `Match count mismatch in ${path}: expected ${target}, found ${matchCount}. ` +
                `Nothing was written. The replacement content has been buffered. ` +
                `Check the occurrences with view.grep or a complete view.read, then retry ` +
                `with the right expected value or a narrower oldText.`
            }
          }, null, 2)
        }]
        , isError: true
      };
    }
    const newContent = canonical
      ? replaceCanonical(content, oldText, newText, target)
      : (target === 1
        ? content.replace(oldText, newText)
        : content.split(oldText).join(newText));
    // A canonical match cannot vanish between the count and the replace —
    // both passes are deterministic — but a null falls through to the
    // fuzzy path rather than writing nothing.
    if (newContent !== null) {
      const write = await api.updateFile(path, newContent);

      return {
        content: [{
          type: 'text'
          , text: `Successfully replaced ${target === 1 ? 'the match' : `${target} occurrences`} ` +
            `${canonical ? '(quote-style tolerant)' : '(exact)'} in ${path}`
        }]
        // Post-write stat for write chaining: echo it back as
        // ifUnmodifiedSince / ifHash on the next edit, no re-read needed.
        , path
        , mtime: write.mtime
        , hash: write.hash
      };
    }
  }

  // Buffer the new content for potential recovery
  buffer.store(newText, undefined, {
    filePath: path
    , searchText: oldText
  });

  // Try fuzzy matching
  const matches = findFuzzyMatches(content, oldText, fuzzyThreshold);

  if (matches.length === 0) {
    // No matches found, provide helpful feedback
    return {
      content: [{
        type: 'text'
        , text: `No matches found for "${oldText}" in ${path}. ` +
              `The replacement has been buffered (one slot, 30 minutes). ` +
              `Retry with different search text and omit newText to reuse the buffered replacement, ` +
              `or use edit(action='at_line') to insert at a specific line.`
      }]
      , isError: true
    };
  }

  // If multiple matches, ask for clarification
  if (matches.length > 1) {
    const matchList = matches.map(m =>
      `Line ${m.lineNumber} (${Math.round(m.similarity * 100)}% match): "${m.line.trim()}"`
    ).join('\n');

    return {
      content: [{
        type: 'text'
        , text: `Found ${matches.length} potential matches:\n\n${matchList}\n\n` +
              `Content has been buffered. Use edit(action='at_line') with the specific line number.`
      }]
      , isError: true
    };
  }

  // Single match found - replace the matched span within the line, not the
  // whole line: the caller scoped oldText to a passage, and the text
  // outside the span is context it did not ask to touch.
  const match = matches[0];
  const lines = content.split('\n');
  const line = lines[match.lineNumber - 1];
  // The phrase-path indices are word-anchored approximations: clamp so a
  // pathological index can never drop text outside the line.
  const start = Math.max(0, Math.min(match.startIndex, line.length));
  const end = Math.max(start, Math.min(match.endIndex, line.length));
  lines[match.lineNumber - 1] = line.slice(0, start) + newText + line.slice(end);
  const newContent = lines.join('\n');

  const write = await api.updateFile(path, newContent);

  return {
    content: [{
      type: 'text'
      , text: `Successfully replaced the matched span on line ${match.lineNumber} (${Math.round(match.similarity * 100)}% match) in ${path}`
    }]
    // Post-write stat for write chaining (see the exact-match branch).
    , path
    , mtime: write.mtime
    , hash: write.hash
  };
}
