/**
 * files concat. Joins files in the order of the paths array. Routed from
 * files.concat, and accepted from edit.concat though the tool schema no
 * longer advertises the edit form.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramBool } from '../shared';
import { ValidationException } from '../../validation/input-validator';
import { SecurityError } from '../../security';
import { isImageFile } from '../../types/obsidian';
import { FileLockManager } from '../../utils/file-lock';

/**
 * Join files in the order of the paths array. Routed from files.concat, and
 * accepted from edit.concat though the tool schema no longer advertises the
 * edit form.
 */
export async function executeConcat(ctx: RouterContext, params: Params): Promise<unknown> {
  const run = () => combineFiles(ctx, params);

  // Lock on the write target (#139's serialization argument, applied here
  // too). destination is required — concat always writes — so there is always
  // a lock target; combineFiles' own validation reports the missing param.
  const lockPath = paramStr(params, 'destination');
  if (!lockPath) return run();
  return FileLockManager.getInstance().withLock(lockPath, run);
}

/**
 * Join files into one document. destination is required: the result is
 * always written (create, or update when overwrite=true).
 */
export async function combineFiles(ctx: RouterContext, params: Params): Promise<unknown> {
  const paths = params.paths as string[] | undefined;
  const destination = paramStr(params, 'destination');
  const separator = paramStr(params, 'separator') ?? '\n\n---\n\n';
  const includeFilenames = paramBool(params, 'includeFilenames') ?? false;
  const overwrite = paramBool(params, 'overwrite') ?? false;
  const sortBy = paramStr(params, 'sortBy');
  const sortOrder = paramStr(params, 'sortOrder') ?? 'asc';

  // Validate batch operation
  const validationResult = ctx.validator.validate('batch.combine', { paths, path: destination });
  if (!validationResult.valid) {
    throw new ValidationException(
      validationResult.errors || [],
      `Validation failed for combine: ${validationResult.errors?.map(e => e.message).join(', ')}`
    );
  }

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths array is required for combine operation');
  }

  // destination is required: concat is a write, and the dispatch layer
  // enforces it for tool calls (MISSING_PARAMETER). This is the router-level
  // backstop. The clobber refusal throw stays outside the try, same as the
  // move case.
  if (!destination) {
    throw new Error('destination is required for combine operation');
  }

  let destExists = false;
  try {
    await ctx.api.getFile(destination);
    destExists = true;
  } catch (error) {
    // File does not exist, which is what we want. A security refusal is
    // not a missing file, so it propagates.
    if (error instanceof SecurityError) {
      throw error;
    }
  }
  if (destExists && !overwrite) {
    throw new Error(`Destination already exists: ${destination}. Set overwrite=true to replace.`);
  }

  // Validate and get all source files
  const sourceFiles = [];
  for (const path of paths) {
    const file = await ctx.api.getFile(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }
    if (isImageFile(file)) {
      throw new Error(`Cannot combine image files: ${path}`);
    }
    sourceFiles.push({ path, content: file.content });
  }

  // Sort files if requested
  if (sortBy) {
    sortFiles(sourceFiles, sortBy, sortOrder);
  }

  // Combine content
  const combinedContent = [];
  for (const file of sourceFiles) {
    if (includeFilenames) {
      const filename = file.path.split('/').pop() || file.path;
      combinedContent.push(`# ${filename}`);
      combinedContent.push('');
    }
    combinedContent.push(file.content);
  }

  const finalContent = combinedContent.join(separator);

  // Create or update destination file
  if (overwrite) {
    await ctx.api.updateFile(destination, finalContent);
  } else {
    await ctx.api.createFile(destination, finalContent);
  }

  return {
    success: true
    , destination
    , filesCombined: paths.length
    , totalSize: finalContent.length
    , workflow: {
      message: `Successfully combined ${paths.length} files into ${destination}`
      , suggested_next: [
        {
          description: 'View the combined file'
          , command: `view(action='read', path='${destination}')`
        }
        , {
          description: 'Edit the combined file'
          , command: `edit(action='replace', path='${destination}', oldText='...', newText='...')`
        }
        , {
          description: 'Split the file back into parts'
          , command: `files(action='split', path='${destination}', splitBy='delimiter', delimiter='${separator}')`
        }
      ]
    }
  };
}

function sortFiles(files: Array<{ path: string; content: string }>, sortBy: string, sortOrder: string): void {
  // For file metadata, we'd need to use Obsidian's API
  // For now, we'll sort by name and size (which we can calculate)

  files.sort((a, b) => {
    let compareValue = 0;

    switch (sortBy) {
      case 'name': {
        const nameA = a.path.split('/').pop() || a.path;
        const nameB = b.path.split('/').pop() || b.path;
        compareValue = nameA.localeCompare(nameB);
        break;
      }

      case 'size':
        compareValue = a.content.length - b.content.length;
        break;

      case 'modified':
      case 'created': {
        // Would need file stats from Obsidian API
        // For now, fall back to name sort
        const fallbackA = a.path.split('/').pop() || a.path;
        const fallbackB = b.path.split('/').pop() || b.path;
        compareValue = fallbackA.localeCompare(fallbackB);
        break;
      }

      default:
        compareValue = 0;
    }

    return sortOrder === 'desc' ? -compareValue : compareValue;
  });
}
