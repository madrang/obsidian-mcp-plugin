/**
 * Edit operation handler (ADR-202). Content edits inside an existing file.
 * All edit actions targeting the same file are serialized through the file
 * lock, so a batched MCP client cannot clobber its own edits (#139).
 */
import { RouterContext } from './router-context';
import { Params, paramStr, paramNum, requireParamStr } from './shared';
import { ContentBufferManager } from '../../utils/content-buffer';
import { FileLockManager } from '../../utils/file-lock';
import { isImageFile } from '../../types/obsidian';
import { executeConcat } from './files';

export async function executeEditOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
  const buffer = ContentBufferManager.getInstance();

  // edit.concat is accepted here too, though the tool schema no longer
  // advertises it.
  if (action === 'concat') {
    return executeConcat(ctx, params);
  }

  // Serialize all edit actions targeting the same file so parallel
  // edit.replace/append/patch/at_line/from_buffer calls from a batched MCP
  // client can no longer silently clobber each other (#139). Different
  // files remain fully concurrent.
  // Guard the lock key up-front so a missing path cannot take a lock on
  // the literal string "undefined" and serialize unrelated bad calls.
  const lockPath = requireParamStr(params, 'path', `edit.${action}`);
  return FileLockManager.getInstance().withLock(lockPath, async () => {
  switch (action) {
    case 'replace': {
      const oldText = requireParamStr(params, 'oldText', 'edit.replace');
      const newText = requireParamStr(params, 'newText', 'edit.replace');
      // Imported dynamically (only when needed) to avoid circular deps.
      const { performWindowEdit } = await import('../../tools/window-edit.js');
      const result = await performWindowEdit(
        ctx.api,
        lockPath,
        oldText,
        newText,
        paramNum(params, 'fuzzyThreshold')
      );
      if (result.isError) {
        throw new Error(result.content[0].text);
      }
      return result;
    }
    case 'append': {
      const content = requireParamStr(
        params,
        'content',
        'edit.append',
        "Pass the text to append as 'content'.",
      );
      return await ctx.api.appendToFile(lockPath, content);
    }
    case 'patch':
      return await ctx.api.patchVaultFile(lockPath, {
        operation: paramStr(params, 'operation'),
        targetType: paramStr(params, 'targetType'),
        target: paramStr(params, 'target'),
        content: paramStr(params, 'content'),
        old_text: paramStr(params, 'oldText'),
        new_text: paramStr(params, 'newText')
      });
    case 'at_line': {
      // Get content to insert
      let insertContent = paramStr(params, 'content');
      if (!insertContent) {
        const buffered = buffer.retrieve();
        if (!buffered) {
          throw new Error('No content provided and no buffered content found');
        }
        insertContent = buffered.content;
      }

      // Get file and perform line-based edit
      const filePath = lockPath;
      const file = await ctx.api.getFile(filePath);
      if (isImageFile(file)) {
        throw new Error('Cannot perform line-based edits on image files');
      }
      const content = typeof file === 'string' ? file : file.content;
      const lines = content.split('\n');
      const lineNumber = paramNum(params, 'lineNumber') ?? 1;

      if (lineNumber < 1 || lineNumber > lines.length + 1) {
        throw new Error(`Invalid line number ${lineNumber}. File has ${lines.length} lines.`);
      }

      const lineIndex = lineNumber - 1;
      const mode = paramStr(params, 'mode') || 'replace';

      switch (mode) {
        case 'before':
          lines.splice(lineIndex, 0, insertContent);
          break;
        case 'after':
          lines.splice(lineIndex + 1, 0, insertContent);
          break;
        case 'replace':
          lines[lineIndex] = insertContent;
          break;
      }

      await ctx.api.updateFile(filePath, lines.join('\n'));
      return { success: true, line: lineNumber, mode };
    }
    case 'from_buffer': {
      const buffered = buffer.retrieve();
      if (!buffered) {
        throw new Error('No buffered content available');
      }
      const { performWindowEdit } = await import('../../tools/window-edit.js');
      return await performWindowEdit(
        ctx.api,
        lockPath,
        paramStr(params, 'oldText') || buffered.searchText || '',
        buffered.content,
        paramNum(params, 'fuzzyThreshold')
      );
    }
    default:
      throw new Error(`Unknown edit action: ${action}`);
  }
  });
}
