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
  description: '✏️ Edit files. Every edit action writes. Actions: replace: find and replace text with fuzzy matching. append: add content to the end of a file. patch: modify headings, blocks, or frontmatter. at_line: insert text at a line number. from_buffer: retry with the content buffered by a failed replace. Warning: patch with operation "replace" removes all content under the target heading. patch on a frontmatter field writes a single value, not a YAML array.',
  actions: ['replace', 'append', 'patch', 'at_line', 'from_buffer'],
  requiredParams: {
    replace: ['path', 'oldText', 'newText'],
    append: ['path', 'content'],
    patch: ['path'],
    // at_line and from_buffer take their content from the buffer when the
    // parameter is omitted, so only the path is unconditionally required.
    at_line: ['path'],
    from_buffer: ['path']
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
