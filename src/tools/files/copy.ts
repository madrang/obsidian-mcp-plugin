/**
 * files copy. A file copy goes through copyFile; when the source does not
 * resolve as a file, the handler retries as a directory and recurses.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramBool } from '../shared';
import { Debug } from '../../utils/debug';
import { isImageFile, ObsidianFileResponse } from '../../types/obsidian';
import { SecurityError } from '../../security';

export async function handleCopy(ctx: RouterContext, params: Params): Promise<unknown> {
  const path = paramStr(params, 'path');
  const destination = paramStr(params, 'destination');
  const overwrite = paramBool(params, 'overwrite') ?? false;

  if (!path || !destination) {
    throw new Error('Both path and destination are required for copy operation');
  }

  // First try as a file (this will go through security validation)
  try {
    const sourceFile = await ctx.api.getFile(path);
    return await copyFile(ctx, path, destination, overwrite, sourceFile);
  } catch (error) {
    // A security refusal is not "maybe it is a directory". Retrying as a
    // directory and then reporting a missing source told a read-only user
    // their file did not exist — same swallow that hid the move/rename
    // traversal, with a misleading error instead of a bypass.
    if (error instanceof SecurityError) {
      throw error;
    }
    // If file operation failed, try as directory (this will also go through security validation)
    try {
      // Test if it is a directory by trying to list its contents
      await ctx.api.listFiles(path);
      // If listing succeeds, it is a directory
      return await copyDirectoryRecursive(ctx, path, destination, overwrite);
    } catch (dirError) {
      if (dirError instanceof SecurityError) {
        throw dirError;
      }
      // Neither file nor directory worked
      throw new Error(`Source not found or inaccessible: ${path}`);
    }
  }
}

/**
 * Copy a single file
 */
async function copyFile(ctx: RouterContext, path: string, destination: string, overwrite: boolean, sourceFile: ObsidianFileResponse): Promise<unknown> {
  // Check if destination already exists. The refusal throw stays outside
  // the try, same as the move case.
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

  // Check for image files
  if (isImageFile(sourceFile)) {
    throw new Error('Cannot copy image files - use Obsidian file explorer');
  }

  const content = sourceFile.content;

  // Create the copy
  if (overwrite) {
    await ctx.api.updateFile(destination, content);
  } else {
    await ctx.api.createFile(destination, content);
  }

  return {
    success: true
    , sourcePath: path
    , copiedTo: destination
    , workflow: {
      message: `File copied successfully from ${path} to ${destination}`
      , suggested_next: [
        {
          description: 'View the copied file'
          , command: `view(action='read', path='${destination}')`
        }
        , {
          description: 'Edit the copied file'
          , command: `edit(action='replace', path='${destination}', oldText='...', newText='...')`
        }
        , {
          description: 'Compare original and copy'
          , command: `view(action='read', path='${path}') then view(action='read', path='${destination}')`
        }
      ]
    }
  };
}

/**
 * Recursively copy a directory and all its contents
 */
async function copyDirectoryRecursive(ctx: RouterContext, sourcePath: string, destPath: string, overwrite: boolean): Promise<unknown> {
  const copiedFiles: string[] = [];
  const skippedFiles: string[] = [];

  const copyDir = async (srcDir: string, destDir: string) => {
    // Use listFilesPaginated to get both files and directories
    const response = await ctx.api.listFilesPaginated(srcDir, 1, 1000); // Get large page to avoid pagination
    const items = response.files;

    for (const item of items) {
      const srcPath = item.path;
      const relativePath = srcPath.startsWith(srcDir + '/') ? srcPath.substring(srcDir.length + 1) : item.name;
      const destFilePath = `${destDir}/${relativePath}`;

      if (item.type === 'folder') {
        // Subdirectory - recurse
        await copyDir(srcPath, destFilePath);
      } else {
        try {
          // File - copy
          const sourceFile = await ctx.api.getFile(srcPath);
          if (isImageFile(sourceFile)) {
            Debug.warn(`Skipping image file: ${srcPath}`);
            skippedFiles.push(srcPath);
            continue;
          }

          // Check destination exists if not overwriting
          if (!overwrite) {
            try {
              await ctx.api.getFile(destFilePath);
              throw new Error(`Destination exists: ${destFilePath}. Set overwrite=true to replace.`);
            } catch (e: unknown) {
              // File does not exist - good to proceed
              if (e instanceof Error && e.message?.includes('Destination exists')) {
                throw e;
              }
            }
          }

          const content = sourceFile.content;
          if (overwrite) {
            await ctx.api.updateFile(destFilePath, content);
          } else {
            await ctx.api.createFile(destFilePath, content);
          }
          copiedFiles.push(destFilePath);
        } catch (error: unknown) {
          if (error instanceof Error && error.message?.includes('Destination exists')) {
            throw error; // Re-throw destination exists errors
          }
          // Log other errors but continue
          const errMsg = error instanceof Error ? error.message : String(error);
          Debug.warn(`Failed to copy ${srcPath}: ${errMsg}`);
          skippedFiles.push(srcPath);
        }
      }
    }
  };

  await copyDir(sourcePath, destPath);

  return {
    success: true
    , sourcePath
    , destinationPath: destPath
    , filesCount: copiedFiles.length
    , copiedFiles
    , skippedFiles
    , workflow: {
      message: `Directory copied successfully: ${copiedFiles.length} files from ${sourcePath} to ${destPath}${skippedFiles.length > 0 ? ` (${skippedFiles.length} files skipped)` : ''}`
      , suggested_next: [
        {
          description: 'List copied directory contents'
          , command: `view(action='folder', directory='${destPath}')`
        }
        , {
          description: 'View a copied file'
          , command: `view(action='read', path='${copiedFiles[0] || destPath + '/README.md'}')`
        }
        , ...(skippedFiles.length > 0 ? [{
          description: 'Review skipped files'
          , command: `Review skipped files: ${skippedFiles.slice(0, 3).join(', ')}${skippedFiles.length > 3 ? '...' : ''}`
        }] : [])
      ]
    }
  };
}
