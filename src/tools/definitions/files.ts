/**
 * The files tool: structural writes (create, delete, move, copy, split,
 * concat). Registers itself into the tool registry at import time.
 */
import { registerOperation, pathParam } from '../tool-registry';
import { executeFilesOperation, FILES_ACTIONS, executeConcat } from '../../semantic/operations/files';
import { executeBasesOperation } from '../../semantic/operations/bases';
import { paramStr } from '../../semantic/operations/shared';

registerOperation({
  name: 'files'
  , title: 'File Management'
  , descriptionLines: [
    '🗂️ File management. Every `files` action writes.'
    , ''
    , '## Actions'
    , { when: 'files.create', text: '- `create` — Write a new file. It refuses a path that already exists. Omit `content` for an empty file. Missing parent folders are created.' }
    , { when: ['files.create', 'gate:overwrite'], text: '  `overwrite=true` replaces the whole content of an existing file.' }
    , { when: 'files.delete', text: '- `delete` — Delete a file.' }
    , { when: 'files.move', text: '- `move` — Move or rename a file.' }
    , { when: 'files.copy', text: '- `copy` — Copy a file to a new path.' }
    , { when: 'files.split', text: '- `split` — Split one file into several. The source file stays.' }
    , { when: 'files.concat', text: '- `concat` — Join several files into one. The source files stay.' }
    , ''
    , '## Rules'
    , '- Every action returns `success` and its outcome, for example the created paths (`split`) or the destination and count (`concat`).'
  ]
  , actions: ['create', 'delete', 'move', 'copy', 'split', 'concat']
  , requiredParams: {
    create: ['path']
    , delete: ['path']
    , move: ['path', 'destination']
    , copy: ['path', 'destination']
    , split: ['path', 'splitBy']
    , concat: ['paths', 'destination']
  }
  , annotations: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false
  }
  , execute: (ctx, action, params) => {
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
  }
  , parameters: {
    ...pathParam
    , content: {
      type: ['string', 'object']
      , description: 'create: the text content to write. With format "base": the Bases configuration object with name, source, properties, and views'
    }
    , format: {
      type: 'string'
      , enum: ['base']
      , description: 'create: the file format. Omit it for raw text. "base" creates an Obsidian Bases view file from the content object, with schema validation'
    }
    , destination: {
      type: 'string'
      , description: 'The destination path for move, copy, and concat. For move: a destination without a directory renames the file in place and keeps its extension. For example, moving "note.md" to "renamed" gives "renamed.md". A destination with a directory is used exactly as given, like copy and concat'
    }
    , overwrite: {
      type: 'boolean'
      , description: 'Overwrite the destination (move, copy, concat) or the file itself (create) when it already exists (default: false). Without it, an existing destination is refused. Overwriting requires the update permission and the Allow overwrite setting'
    }
    // Split operation parameters
    , splitBy: {
      type: 'string'
      , enum: ['heading', 'delimiter', 'lines', 'size']
      , description: 'The split strategy: heading (by markdown headings), delimiter (by a custom string), lines (by line count), size (by character count)'
    }
    , delimiter: {
      type: 'string'
      , description: 'The delimiter string or regex for the delimiter strategy (default: "---")'
    }
    , level: {
      type: 'number'
      , description: 'The heading level for the heading strategy (1-6, default: 1). The split cuts at headings of exactly this level. Each output file starts with its heading line. Text before the first heading becomes its own file'
    }
    , linesPerFile: {
      type: 'number'
      , description: 'The number of lines per file for the lines strategy (default: 100)'
    }
    , maxSize: {
      type: 'number'
      , description: 'The maximum number of characters per file for the size strategy (default: 10000)'
    }
    , outputPattern: {
      type: 'string'
      , description: 'The naming pattern for the output files (default: "{filename}-{index}{ext}"). Placeholders: {filename}, {index} (1-based, zero-padded to 3 digits), {ext}. No others are supported'
    }
    , outputDirectory: {
      type: 'string'
      , description: 'The directory for the output files (default: the source directory)'
    }
    // Concat operation parameters
    , paths: {
      type: 'array'
      , items: { type: 'string' }
      , description: 'The array of file paths to join with concat, in order'
    }
    , separator: {
      type: 'string'
      , description: 'The content separator between the joined files (default: "\\n\\n---\\n\\n")'
    }
    , includeFilenames: {
      type: 'boolean'
      , description: 'Include the source filenames as headers (default: false)'
    }
    , sortBy: {
      type: 'string'
      , enum: ['name', 'modified', 'created', 'size']
      , description: 'Sort the files before joining. This overrides the paths order'
    }
    , sortOrder: {
      type: 'string'
      , enum: ['asc', 'desc']
      , description: 'The sort order (default: "asc")'
    },
  }
});
