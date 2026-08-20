/**
 * The files tool: structural writes (create, delete, move, copy, split,
 * concat). Registers itself into the tool registry at import time.
 */
import { registerOperation, pathParam } from '../tool-registry';
import { executeFilesOperation, FILES_ACTIONS, executeConcat } from '../../semantic/operations/files';
import { executeBasesOperation } from '../../semantic/operations/bases';
import { paramStr } from '../../semantic/operations/shared';

registerOperation({
  name: 'files',
  title: 'File Management',
  description: '🗂️ File management: create, delete, move, copy, split, and concat. Every files action writes. create makes a new file: raw text, or an Obsidian Bases view with format "base". Set overwrite=true to replace the whole content of an existing file. concat joins files into one, in the order of the paths array. To rename a file in place, use move with a destination that has no directory.',
  actions: ['create', 'delete', 'move', 'copy', 'split', 'concat'],
  requiredParams: {
    create: ['path'],
    delete: ['path'],
    move: ['path', 'destination'],
    copy: ['path', 'destination'],
    split: ['path', 'splitBy'],
    concat: ['paths', 'destination']
  },
  annotations: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false
  },
  execute: (ctx, action, params) => {
    // The files tool owns only the write actions. The shared read-side cases
    // in operations/files.ts are reached through the view tool.
    if (!(FILES_ACTIONS as readonly string[]).includes(action)) {
      throw new Error(`Unknown files action: ${action}`);
    }
    if (action === 'concat') {
      return executeConcat(ctx, params);
    }
    // format "base" creates a structured, schema-validated Bases view file.
    // Anything else is a raw text file create.
    if (action === 'create' && paramStr(params, 'format') === 'base') {
      return executeBasesOperation(ctx, 'create', params);
    }
    return executeFilesOperation(ctx, action, params);
  },
  parameters: {
    ...pathParam,
    content: {
      type: ['string', 'object'],
      description: 'create: the text content to write (markdown supported). With format "base": the Bases configuration object with name, source, properties, and views'
    },
    format: {
      type: 'string',
      enum: ['base'],
      description: 'create: the file format. Omit it for raw text. "base" creates an Obsidian Bases view file from the content object, with schema validation'
    },
    destination: {
      type: 'string',
      description: 'The destination path for move, copy, and concat. For move: a destination without a directory renames the file in place and keeps its extension. For example, moving "note.md" to "renamed" gives "renamed.md"'
    },
    overwrite: {
      type: 'boolean',
      description: 'Replace existing content: the destination for move, copy, and concat, or the file itself for create (default: false). Overwriting requires the update permission and the Allow overwrite setting'
    },
    // Split operation parameters
    splitBy: {
      type: 'string',
      enum: ['heading', 'delimiter', 'lines', 'size'],
      description: 'The split strategy: heading (by markdown headings), delimiter (by a custom string), lines (by line count), size (by character count)'
    },
    delimiter: {
      type: 'string',
      description: 'The delimiter string or regex for the delimiter strategy (default: "---")'
    },
    level: {
      type: 'number',
      description: 'The heading level for the heading strategy (1-6)'
    },
    linesPerFile: {
      type: 'number',
      description: 'The number of lines per file for the lines strategy (default: 100)'
    },
    maxSize: {
      type: 'number',
      description: 'The maximum number of characters per file for the size strategy (default: 10000)'
    },
    outputPattern: {
      type: 'string',
      description: 'The naming pattern for the output files (default: "{filename}-{index}{ext}")'
    },
    outputDirectory: {
      type: 'string',
      description: 'The directory for the output files (default: the source directory)'
    },
    // Concat operation parameters
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'The array of file paths to join with concat, in order'
    },
    separator: {
      type: 'string',
      description: 'The content separator between the joined files (default: "\\n\\n---\\n\\n")'
    },
    includeFilenames: {
      type: 'boolean',
      description: 'Include the source filenames as headers (default: false)'
    },
    sortBy: {
      type: 'string',
      enum: ['name', 'modified', 'created', 'size'],
      description: 'Sort the files before joining'
    },
    sortOrder: {
      type: 'string',
      enum: ['asc', 'desc'],
      description: 'The sort order (default: "asc")'
    },
  }
});
