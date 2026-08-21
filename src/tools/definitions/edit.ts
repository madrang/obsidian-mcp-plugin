/**
 * The edit tool: content edits inside an existing file (replace, append,
 * patch, at_line, from_buffer). Registers itself into the tool registry at
 * import time.
 */
import { registerOperation, pathParam, contentParam } from '../tool-registry';
import { executeEditOperation } from '../../semantic/operations/edit';

registerOperation({
  name: 'edit',
  title: 'Edit Files',
  descriptionLines: [
    '✏️ Edit files. Every `edit` action writes.',
    '',
    '## Actions',
    { when: 'edit.replace', text: '- `replace` — find and replace text. The count guard: `expected` (default 1) occurrences must match exactly, or nothing is written. `expected` above 1 replaces all of them.' },
    { when: 'edit.append', text: '- `append` — add content to the end of a file.' },
    { when: 'edit.patch', text: '- `patch` — modify a heading, a block, or a frontmatter field.' },
    { when: 'edit.at_line', text: '- `at_line` — insert text at a line number.' },
    { when: 'edit.from_buffer', text: '- `from_buffer` — retry with the content buffered by a failed replace.' },
    { when: 'edit.multi', text: '- `multi` — apply several exact find-and-replace pairs in one write.' },
    '',
    '## Rules',
    '- Every action accepts an `ifUnmodifiedSince` or `ifHash` precondition. A mismatch refuses the write.',
    '- A successful write returns the new `mtime` and `hash`. Chain writes without a re-read until the chain breaks.',
    { when: 'edit.patch', text: '- Warning: `patch` with `operation: "replace"` removes all content under the target heading.' },
    { when: 'edit.patch', text: '- `patch` on a frontmatter field writes a single value, not a YAML array.' }
  ],
  actions: ['replace', 'append', 'patch', 'at_line', 'from_buffer', 'multi'],
  requiredParams: {
    replace: ['path', 'oldText', 'newText'],
    append: ['path', 'content'],
    patch: ['path'],
    // at_line and from_buffer take their content from the buffer when the
    // parameter is omitted, so only the path is unconditionally required.
    at_line: ['path'],
    from_buffer: ['path'],
    multi: ['path', 'edits']
  },
  annotations: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false
  },
  execute: executeEditOperation,
  parameters: {
    ...pathParam,
    ...contentParam,
    oldText: {
      type: 'string',
      description: 'The text to search for (supports fuzzy matching). Scope it to a unique passage in the file. Set fuzzyThreshold to 1.0 for an exact substring replace'
    },
    newText: {
      type: 'string',
      description: 'The replacement text'
    },
    fuzzyThreshold: {
      type: 'number',
      description: 'The similarity threshold for fuzzy matching (0-1)',
      default: 0.7
    },
    expected: {
      type: 'number',
      description: 'replace: the exact number of occurrences oldText must match. Default 1 — exactly one occurrence, that one is replaced. N above 1 — exactly N occurrences, all replaced. Any other count refuses the edit with MATCH_COUNT_MISMATCH and nothing is written. Check the count first with view.grep or a complete view.read'
    },
    // Write preconditions, accepted by every edit action. The values come
    // from a view.read that returned the complete file — there is no way to
    // get them without reading the content.
    ifUnmodifiedSince: {
      type: 'number',
      description: 'Precondition: proceed only when the file mtime (ms epoch) still equals this value. Get it from a complete view.read of the file (visible in raw mode). On mismatch the edit is refused with PRECONDITION_FAILED and nothing is written'
    },
    ifHash: {
      type: 'string',
      description: 'Precondition: proceed only when the file content hash still equals this value. Get it from a complete view.read of the file (visible in raw mode). On mismatch the edit is refused with PRECONDITION_FAILED and nothing is written'
    },
    edits: {
      type: 'array',
      description: 'The multi action: an ordered list of find-and-replace pairs applied in one write. Each pair must match exactly (no fuzzy matching) and replaces the first occurrence. Pair n applies to the result of pair n-1. Every pair is verified before anything is written; on any mismatch the whole batch is refused and nothing is written',
      items: {
        type: 'object',
        properties: {
          oldText: { type: 'string', description: 'The exact text to find (non-empty)' },
          newText: { type: 'string', description: 'The replacement text' }
        },
        required: ['oldText', 'newText']
      }
    },
    lineNumber: {
      type: 'number',
      description: 'The 1-based line number for the at_line action. Line numbers shift after earlier edits, so re-derive them from a fresh read'
    },
    mode: {
      type: 'string',
      enum: ['before', 'after', 'replace'],
      description: 'The insert mode for at_line: before the line, after the line, or replace the line (default: replace)'
    },
    operation: {
      type: 'string',
      enum: ['append', 'prepend', 'replace'],
      description: 'The patch operation: append (add after), prepend (add before), or replace'
    },
    targetType: {
      type: 'string',
      enum: ['heading', 'block', 'frontmatter'],
      description: 'The structure to target: heading (use :: for nesting), block (by ID), or frontmatter (field name)'
    },
    target: {
      type: 'string',
      description: 'The target identifier (for example "Section::Subsection", "blockId", "status"). For a heading, use the full path from the top-level heading joined by ::, case-sensitive'
    },
  }
});
