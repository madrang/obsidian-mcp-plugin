/**
 * files move. A destination without a directory renames in place, one with a
 * directory relocates (vault-root-relative, with or without a leading
 * slash) — one parameter covers both.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramBool } from '../shared';
import { isImageFile } from '../../types/obsidian';
import { SecurityError } from '../../security';

/**
 * Extension of a vault path, including the leading dot ('' when there is none).
 * A leading dot is not an extension: '.gitignore' has none.
 */
function extensionOf(path: string): string {
  const base = path.substring(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.substring(dot) : '';
}

export async function handleMove(ctx: RouterContext, params: Params): Promise<unknown> {
  const path = paramStr(params, 'path');
  const overwrite = paramBool(params, 'overwrite') ?? false;
  let destination = paramStr(params, 'destination');

  if (!path || !destination) {
    throw new Error('The move operation needs path and destination. To rename in place, give a destination without a directory');
  }

  // Check if source file exists
  const sourceFile = await ctx.api.getFile(path);
  if (!sourceFile) {
    throw new Error(`Source file not found: ${path}`);
  }

  // A bare destination renames in place: same folder, with the source
  // extension carried over when destination omits one, so renaming
  // 'note.md' to 'renamed' yields 'renamed.md' rather than an
  // extension-less file that drops out of markdown views (#253).
  const inPlace = !destination.includes('/');
  if (inPlace) {
    const lastSlash = path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? path.substring(0, lastSlash) : '';
    const resolvedName = extensionOf(destination) ? destination : `${destination}${extensionOf(path)}`;
    destination = dir ? `${dir}/${resolvedName}` : resolvedName;
  }

  // Check if destination already exists. The refusal throw must stay
  // OUTSIDE the try: this catch swallows every non-security error, so
  // a throw inside the try would catch its own refusal.
  let destExists = false;
  try {
    await ctx.api.getFile(destination);
    destExists = true;
  } catch (error) {
    // A rejected destination is not a "does not exist yet" — swallowing it
    // here is what let a `../` destination through to the rename call.
    if (error instanceof SecurityError) {
      throw error;
    }
    // Otherwise the file does not exist, which is what we want
  }
  if (destExists && !overwrite) {
    throw new Error(`Destination already exists: ${destination}. Set overwrite=true to replace.`);
  }

  // Directory creation is handled automatically by createFile

  // Route through the API layer, not app.fileManager directly, so the
  // security layer validates the destination as well as the source.
  {
    const abstractFile = ctx.app?.vault.getAbstractFileByPath(path);
    if (abstractFile && 'extension' in abstractFile) {
      await ctx.api.moveFile(path, destination);
      return {
        success: true
        , oldPath: path
        , newPath: destination
        , workflow: {
          message: `File ${inPlace ? 'renamed' : 'moved'} successfully from ${path} to ${destination}`
          , suggested_next: [
            {
              description: 'View the moved file'
              , command: `view(action='read', path='${destination}')`
            }
            , {
              description: 'Edit the moved file'
              , command: `edit(action='replace', path='${destination}', oldText='...', newText='...')`
            }
          ]
        }
      };
    }
  }

  // Fallback: copy and delete
  const sourceFileData = await ctx.api.getFile(path);
  if (isImageFile(sourceFileData)) {
    throw new Error('Cannot move image files using fallback method');
  }
  const content = sourceFileData.content;
  await ctx.api.createFile(destination, content);
  await ctx.api.deleteFile(path);

  return {
    success: true
    , oldPath: path
    , newPath: destination
    , workflow: {
      message: `File moved successfully from ${path} to ${destination}`
      , suggested_next: [
        {
          description: 'View the moved file'
          , command: `view(action='read', path='${destination}')`
        }
        , {
          description: 'Edit the moved file'
          , command: `edit(action='replace', path='${destination}', oldText='...', newText='...')`
        }
      ]
    }
  };
}
