/**
 * The files tool: structural writes (create, delete, move, copy, split,
 * concat). Registers itself into the tool registry at import time.
 */
import { registerOperation, pathParam } from '../tool-registry';
import { executeFilesOperation } from './operations';
import { formatFilesResponse } from './format';

registerOperation({
  name: 'files'
  , title: 'File Management'
  , descriptionLines: [
    'Create, delete, move, copy, split, and join files. Every `files` action writes.'
    , ''
    , '## Actions'
    , { when: 'files.create', text: '- `create` — Write a new file. It refuses a path that already exists. Missing parent folders are created.' }
    , { when: 'files.delete', text: '- `delete` — Delete a file. It moves to the Obsidian trash.' }
    , { when: 'files.move', text: '- `move` — Move or rename a file.' }
    , { when: 'files.copy', text: '- `copy` — Copy a file to a new path.' }
    , { when: 'files.split', text: '- `split` — Split one file into several. The source file stays.' }
    , { when: 'files.concat', text: '- `concat` — Join several files into one. The source files stay.' }
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
  , execute: executeFilesOperation
  , format: formatFilesResponse
  , parameters: {
    ...pathParam
    , content: {
      type: ['string', 'object']
      , description: 'create: the text content to write. Omit it for an empty file. With format "base": the Bases configuration object — filters, formulas, properties, and views. `views` is required, at least one. Copy a `bases.read` result and edit it. With format "folder": omit it; a folder takes no content'
    }
    , format: {
      type: 'string'
      , enum: ['base', 'folder']
      , description: 'create: what to write. Omit it for a raw text file. "base" creates an Obsidian Bases view file from the content object, with schema validation. "folder" creates a directory at path, with any missing parents; a non-empty content is refused'
    }
    , destination: {
      type: 'string'
      , description: 'The destination path for move, copy, and concat. A destination with a directory is used exactly as given, for all three actions. For move only: a destination without a directory renames the file in place, and the source extension is appended when the destination carries none. Copy and concat create missing destination folders. A move needs an existing target folder'
    }
    , overwrite: {
      type: 'boolean'
      , description: 'Overwrite the destination (move, copy, concat) or the file itself (create) when it already exists. Without it, an existing destination is refused. Overwriting requires the update permission and the Allow overwrite setting. A missing grant refuses the write with OVERWRITE_DISABLED'
      , default: false
    }
    // Split operation parameters
    , splitBy: {
      type: 'string'
      , enum: ['heading', 'delimiter', 'lines', 'size']
      , description: 'The split strategy: heading (by markdown headings), delimiter (by a custom string), lines (by line count), size (by character count)'
    }
    , delimiter: {
      type: 'string'
      , description: 'The delimiter string for the delimiter strategy'
      , default: '---'
    }
    , level: {
      type: 'number'
      , description: 'The heading level for the heading strategy (1-6). The split cuts at headings of exactly this level. Each output file starts with its heading line. Text before the first heading becomes its own file. Without such a heading, the whole file becomes one output'
      , default: 1
    }
    , linesPerFile: {
      type: 'number'
      , description: 'The number of lines per file for the lines strategy'
      , default: 100
    }
    , maxSize: {
      type: 'number'
      , description: 'The maximum number of characters per file for the size strategy'
      , default: 10000
    }
    , outputPattern: {
      type: 'string'
      , description: 'The naming pattern for the output files. Placeholders: {filename} (name without extension), {index} (1-based, zero-padded to 3 digits), {ext} (extension with its dot, empty without one).'
      , default: '{filename}-{index}{ext}'
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
      , description: 'The content separator between the joined files'
      , default: '\n\n---\n\n'
    }
    , includeFilenames: {
      type: 'boolean'
      , description: 'Include the source filenames as headers'
      , default: false
    }
    , sortBy: {
      type: 'string'
      , enum: ['name', 'modified', 'created', 'size']
      , description: 'Sort the files before joining. This overrides the paths order'
    }
    , sortOrder: {
      type: 'string'
      , enum: ['asc', 'desc']
      , description: 'The sort order'
      , default: 'asc'
    },
  }
});
