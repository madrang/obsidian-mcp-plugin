/**
 * The edit tool: content edits inside an existing file (replace, append,
 * patch, at_line). Registers itself into the tool registry at
 * import time.
 */
import { registerOperation, pathParam } from '../tool-registry';
import { executeEditOperation } from '../../semantic/operations/edit';

registerOperation({
  name: 'edit'
  , title: 'Edit Files'
  , descriptionLines: [
    'Edit the text of existing files: find-and-replace, append, structural patch, line inserts, and batch pairs. Every `edit` action writes.'
    , ''
    , '## Actions'
    , { when: 'edit.replace', text: '- `replace` — Find and replace text.' }
    , { when: 'edit.append', text: '- `append` — Add content to the end of a file.' }
    , { when: 'edit.patch', text: '- `patch` — Modify a heading, a block, or a frontmatter field.' }
    , { when: 'edit.patch', text: '  On a heading: `append` adds at the end of the section. `prepend` adds directly under the heading. `replace` rewrites the whole section content, and the heading line stays.' }
    , { when: 'edit.patch', text: '  On a block: the block is the line that ends with `^blockId`. The operations rewrite that line, and the ID stays.' }
    , { when: 'edit.patch', text: '  A missing heading or block errors.' }
    , { when: 'edit.patch', text: '  On a frontmatter field: `value` (with `replace`) writes any type — string, number, boolean, array, object — serialized as YAML. `newText` writes text. `append` adds after the current text value, `prepend` before it, and both refuse a field that holds an array or object. `remove` deletes the field. A missing field is created. Only the target field\'s lines change.' }
    , { when: 'edit.at_line', text: '- `at_line` — Insert or replace text at a line number.' }
    , { when: 'edit.multi', text: '- `multi` — Apply several exact find-and-replace pairs in one write.' }
    , ''
    , '## Rules'
    , '- Every action accepts `ifUnmodifiedSince` and `ifHash`. Supply both to require both.'
    , '- A successful write returns the new `mtime` and `hash`.'
    , '- An empty `newText` string is a real value. Omitting `newText` on `replace`, `append`, `patch`, or `at_line` reuses the replacement buffered by the last failed `replace` (a count mismatch or a failed match). The buffer is one global slot, shared across files, and it lives 30 minutes. An empty buffer refuses the call.'
  ]
  , actions: ['replace', 'append', 'patch', 'at_line', 'multi']
  , requiredParams: {
    // newText stays off the required lists on purpose: every action accepts
    // its absence as buffer reuse, and the handler enforces the no-buffer
    // error itself.
    replace: ['path', 'oldText']
    , append: ['path']
    , patch: ['path', 'targetType', 'target', 'operation']
    , at_line: ['path']
    , multi: ['path', 'edits']
  }
  , annotations: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false
  }
  , execute: executeEditOperation
  , parameters: {
    ...pathParam
    , oldText: {
      type: 'string'
      , description: 'The text to search for (supports fuzzy matching). Scope it to a unique passage in the file. Set fuzzyThreshold to 1.0 for an exact substring replace'
    }
    , newText: {
      type: 'string'
      , description: 'The text this action writes (replace, append, patch, at_line)'
    }
    , fuzzyThreshold: {
      type: 'number'
      , description: 'The similarity threshold for fuzzy matching (0-1). 1.0 matches exact text only. Lower values accept more difference'
      , default: 0.7
    }
    , expected: {
      type: 'number'
      , description: 'replace: the exact number of occurrences oldText must match. Default 1 — exactly one occurrence, that one is replaced. N above 1 — exactly N occurrences, all replaced. Any other count refuses the edit with MATCH_COUNT_MISMATCH and nothing is written. The count must be at least 1.'
    }
    // Write preconditions, accepted by every edit action. The values come
    // from a view.read that returned the complete file — there is no way to
    // get them without reading the content.
    , ifUnmodifiedSince: {
      type: 'number'
      , description: 'Precondition: proceed only when the file mtime (ms epoch) still equals this value. Get it from a complete view.read of the file (visible in raw mode). On mismatch the edit is refused with PRECONDITION_FAILED and nothing is written'
    }
    , ifHash: {
      type: 'string'
      , description: 'Precondition: proceed only when the file content hash still equals this value. On mismatch the edit is refused with PRECONDITION_FAILED and nothing is written'
    }
    , edits: {
      type: 'array'
      , description: 'The multi action: an ordered list of find-and-replace pairs applied in one write. Each pair must match exactly (no fuzzy matching) and replaces the first occurrence. Pair n applies to the result of pair n-1. Every pair is verified before anything is written; on any mismatch the whole batch is refused and nothing is written'
      , items: {
        type: 'object'
        , properties: {
          oldText: { type: 'string', description: 'The exact text to find (non-empty)' }
          , newText: { type: 'string', description: 'The replacement text' }
        }
        , required: ['oldText', 'newText']
      }
    }
    , lineNumber: {
      type: 'number'
      , description: 'The 1-based line number for the at_line action (default: 1). Line numbers shift after earlier edits, so re-derive them from a fresh read'
    }
    , mode: {
      type: 'string'
      , enum: ['before', 'after', 'replace']
      , description: 'The insert mode for at_line: before the line, after the line, or replace the line (default: replace)'
    }
      , operation: {
        type: 'string'
        , enum: ['append', 'prepend', 'replace', 'remove']
        , description: 'The patch operation: append, prepend, replace, or remove. `remove` works on a frontmatter field only'
      }
      , value: {
        description: 'patch on a frontmatter field: the new value, any type (string, number, boolean, array, object, null), serialized as YAML. Works with operation "replace" only. Mutually exclusive with newText'
      }
    , targetType: {
      type: 'string'
      , enum: ['heading', 'block', 'frontmatter']
      , description: 'The structure to target: heading, block (by ID), or frontmatter (field name)'
    }
    , target: {
      type: 'string'
      , description: 'The target identifier (for example "Section::Subsection", "blockId", "status"). For a heading, use the full path from the top-level heading joined by ::, case-sensitive'
    },
  }
});
