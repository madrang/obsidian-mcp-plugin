/**
 * files create. Three formats share one action: raw text by default,
 * format "base" a schema-validated Bases view file, format "folder" a
 * directory.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramBool, requireParamStr } from '../shared';
import { SecurityError } from '../../security';
import { executeBasesOperation } from '../bases/operations';

export async function handleCreate(ctx: RouterContext, params: Params): Promise<unknown> {
  // format "base" creates a structured, schema-validated Bases view file.
  // The bases handler owns the param contract for that form.
  const format = paramStr(params, 'format');
  if (format === 'base') {
    return executeBasesOperation(ctx, 'create', params);
  }

  const path = requireParamStr(params, 'path', 'files.create');

  // format "folder" creates a directory. Content has no meaning for a
  // folder: a non-empty value is refused before any vault call.
  if (format === 'folder') {
    const folderContent = params.content;
    if (folderContent !== undefined && folderContent !== '') {
      throw new Error(
        `files.create with format "folder" takes no content: ${path}. Omit content to create the folder`
      );
    }
    return await ctx.api.createFolder(path);
  }

  // Raw text. Empty content is a legitimate "touch" — only the path is
  // required.
  const content = paramStr(params, 'content') ?? '';
  // Overwrite turns create into an upsert. An existing file is written
  // through updateFile on purpose: overwriting IS an update, so the
  // security layer must charge the UPDATE permission, not CREATE — a
  // setup with create on and update off must not gain overwrite.
  let exists = false;
  try {
    await ctx.api.getFile(path);
    exists = true;
  } catch (error) {
    // A rejected path is not a "does not exist yet" — see handleMove.
    if (error instanceof SecurityError) {
      throw error;
    }
  }
  if (exists) {
    if (paramBool(params, 'overwrite') !== true) {
      throw new Error(`File already exists: ${path}. Set overwrite=true to replace its content`);
    }
    await ctx.api.updateFile(path, content);
    return { success: true, path, overwritten: true };
  }
  return await ctx.api.createFile(path, content);
}
