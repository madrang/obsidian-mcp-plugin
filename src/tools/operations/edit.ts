/**
 * Edit operation handler (ADR-202). Content edits inside an existing file.
 * All edit actions targeting the same file are serialized through the file
 * lock, so a batched MCP client cannot clobber its own edits (#139).
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramNum, requireParamStr } from '../shared';
import { ContentBufferManager } from '../../utils/content-buffer';
import { FileLockManager } from '../../utils/file-lock';
import { replaceCanonical } from '../../utils/quote-normalize';
import { isImageFile } from '../../types/obsidian';
import { executeConcat } from '../files/concat';

/** Refusal of a write whose precondition failed. The router surfaces `code`
 * verbatim, so callers get PRECONDITION_FAILED instead of UNKNOWN_ERROR. */
class PreconditionError extends Error {
  readonly code = 'PRECONDITION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'PreconditionError';
  }
}

/**
 * Write preconditions: stats from a complete `view.read` echoed back by the
 * caller. Runs
 * inside the file lock, so no other MCP write can land between the check
 * and the write; a human edit in Obsidian can still race, the check only
 * narrows that window. A mismatch refuses the edit before any mutation —
 * the caller's view of the file is stale and must be re-read.
 */
async function checkWritePreconditions(ctx: RouterContext, path: string, params: Params): Promise<void> {
  const hasMtime = 'ifUnmodifiedSince' in params;
  const hasHash = 'ifHash' in params;
  if (!hasMtime && !hasHash) return;

  const expectedMtime = paramNum(params, 'ifUnmodifiedSince');
  const expectedHash = paramStr(params, 'ifHash');
  // Present but malformed must fail closed, not silently skip the guard.
  if ((hasMtime && expectedMtime === undefined) || (hasHash && expectedHash === undefined)) {
    throw new PreconditionError(
      `Precondition failed for ${path}: ifUnmodifiedSince must be a number and ifHash a string.`
    );
  }

  const stat = await ctx.api.getFileStat(path);
  if (!stat.exists) {
    throw new PreconditionError(
      `Precondition failed for ${path}: the file does not exist. Re-read it, then retry.`
    );
  }
  if (expectedMtime !== undefined && stat.mtime !== expectedMtime) {
    throw new PreconditionError(
      `Precondition failed for ${path}: expected mtime ${expectedMtime}, current ${stat.mtime}. ` +
      `The file changed since it was read. Re-read it, then retry.`
    );
  }
  if (expectedHash !== undefined && stat.hash !== expectedHash) {
    throw new PreconditionError(
      `Precondition failed for ${path}: expected hash ${expectedHash}, current ${stat.hash}. ` +
      `The file changed since it was read. Re-read it, then retry.`
    );
  }
}

/**
 * Surface a coded isError result from performWindowEdit as a thrown error the
 * router reports with its code (MATCH_COUNT_MISMATCH), keeping the prose
 * messages of the fuzzy failure paths as plain uncoded errors.
 */
function throwWindowEditError(result: { isError?: boolean; content: { text: string }[] }): never {
  const text = result.content[0]?.text ?? 'Edit failed';
  let message = text;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error?.message) {
      message = parsed.error.message;
      code = parsed.error.code;
    }
  } catch {
    // Prose message from the fuzzy paths — nothing to extract.
  }
  const error = new Error(message);
  if (code) (error as Error & { code?: string }).code = code;
  throw error;
}

/**
 * Some MCP client bridges stringify parameters that carry no schema type.
 * The typed `value` parameter is exactly such a shape, so an array or
 * object can arrive as its JSON text — and the YAML layer would then
 * quote it as a scalar. Parse JSON text back into the value; anything
 * that does not parse is the caller's string and passes through unchanged.
 */
function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * newText is the write text of every action that takes one (multi's pairs
 * carry their own). Present — including as an empty string, which is a real
 * value — it is used as-is. Absent, it falls back to the replacement
 * buffered by the last failed replace. With nothing buffered the call
 * refuses before any vault access.
 */
function resolveNewText(buffer: ContentBufferManager, params: Params, action: string): string {
  if ('newText' in params) {
    return requireParamStr(params, 'newText', `edit.${action}`);
  }
  const buffered = buffer.retrieve();
  if (!buffered) {
    throw new Error(
      `edit.${action} requires 'newText'. Omit it only to reuse the replacement buffered by a failed replace — none is buffered.`
    );
  }
  return buffered.content;
}

export async function executeEditOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
  const buffer = ContentBufferManager.getInstance();

  // edit.concat is accepted here too, though the tool schema no longer
  // advertises it.
  if (action === 'concat') {
    return executeConcat(ctx, params);
  }
  // Serialize all edit actions targeting the same file so parallel
  // edit.replace/append/patch/at_line calls from a batched MCP
  // client can no longer silently clobber each other (#139). Different
  // files remain fully concurrent.
  // Guard the lock key up-front so a missing path cannot take a lock on
  // the literal string "undefined" and serialize unrelated bad calls.
  const lockPath = requireParamStr(params, 'path', `edit.${action}`);
  return FileLockManager.getInstance().withLock(lockPath, async () => {
  await checkWritePreconditions(ctx, lockPath, params);
  switch (action) {
    case 'replace': {
      const oldText = requireParamStr(params, 'oldText', 'edit.replace');
      const newText = resolveNewText(buffer, params, 'replace');
      // Present but non-number must fail closed, not silently drop the guard.
      if ('expected' in params && paramNum(params, 'expected') === undefined) {
        throw new Error(`edit.replace: 'expected' must be a whole number of at least 1.`);
      }
      // Imported dynamically (only when needed) to avoid circular deps.
      const { performWindowEdit } = await import('../window-edit.js');
      const result = await performWindowEdit(
        ctx.api,
        lockPath,
        oldText,
        newText,
        paramNum(params, 'fuzzyThreshold'),
        paramNum(params, 'expected')
      );
      if (result.isError) {
        throwWindowEditError(result);
      }
      return result;
    }
    case 'append':
      return await ctx.api.appendToFile(lockPath, resolveNewText(buffer, params, 'append'));
    case 'patch': {
      const targetType = paramStr(params, 'targetType');
      // A typed value replaces newText on frontmatter targets: any JSON
      // type, serialized as YAML at the API layer. Fail closed on both
      // misuse directions before any vault access.
      if ('value' in params) {
        if ('newText' in params) {
          throw new Error('edit.patch: value and newText are mutually exclusive. Pass one.');
        }
        if (targetType !== 'frontmatter') {
          throw new Error('edit.patch: value works on a frontmatter field only (targetType "frontmatter").');
        }
        return await ctx.api.patchVaultFile(lockPath, {
          operation: paramStr(params, 'operation')
          , targetType
          , target: paramStr(params, 'target')
          , value: parseJsonValue(params.value)
        });
      }
      // remove deletes a field and reads no write text, so the newText
      // demand cannot apply to it.
      const patchOperation = paramStr(params, 'operation');
      return await ctx.api.patchVaultFile(lockPath, {
        operation: patchOperation
        , targetType
        , target: paramStr(params, 'target')
        , content: patchOperation === 'remove' ? '' : resolveNewText(buffer, params, 'patch')
        , old_text: paramStr(params, 'oldText')
        , new_text: paramStr(params, 'newText')
      });
    }
    case 'at_line': {
      const insertContent = resolveNewText(buffer, params, 'at_line');

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

      const write = await ctx.api.updateFile(filePath, lines.join('\n'));
      // Post-write stat for write chaining: echo it back as
      // ifUnmodifiedSince / ifHash on the next edit, no re-read needed.
      return { success: true, line: lineNumber, mode, mtime: write.mtime, hash: write.hash };
    }
    case 'multi': {
      // Shape validation the flat dispatch guard cannot express: a non-empty
      // array of exact-match pairs, capped by the batch size limit.
      const edits = params.edits;
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error(
          `edit.multi requires 'edits': a non-empty array of {oldText, newText} pairs.`
        );
      }
      const batchCheck = ctx.validator.validate('edit.multi', { edits });
      if (!batchCheck.valid) {
        throw new Error(`edit.multi rejected: ${batchCheck.errors?.map(e => e.message).join(', ')}`);
      }
      const pairs = edits.map((pair, i) => {
        const p = pair as { oldText?: unknown; newText?: unknown };
        if (typeof p !== 'object' || p === null ||
            typeof p.oldText !== 'string' || p.oldText === '' ||
            typeof p.newText !== 'string') {
          throw new Error(
            `edit.multi: pair ${i + 1} must be an object with a non-empty string 'oldText' ` +
            `and a string 'newText'. Nothing was written.`
          );
        }
        return { oldText: p.oldText, newText: p.newText };
      });

      const file = await ctx.api.getFile(lockPath);
      if (isImageFile(file)) {
        throw new Error('Cannot perform batch edits on image files');
      }
      const content = typeof file === 'string' ? file : file.content;

      // Verify-and-apply in memory; the single updateFile below is the only
      // write, so a failing pair leaves the file untouched. Pair n applies to
      // the result of pair n-1, in order. Each pair matches exactly first,
      // then once in the canonical quote-class form (typographic vs ASCII):
      // the file and the pair can differ by invisible characters.
      let working = content;
      for (let i = 0; i < pairs.length; i++) {
        const { oldText, newText } = pairs[i];
        if (working.includes(oldText)) {
          working = working.replace(oldText, newText);
          continue;
        }
        const canonical = replaceCanonical(working, oldText, newText, 1);
        if (canonical !== null) {
          working = canonical;
          continue;
        }
        const excerpt = oldText.length > 60 ? `${oldText.slice(0, 60)}…` : oldText;
        throw new Error(
          `edit.multi: pair ${i + 1} of ${pairs.length} not found (exact match). ` +
          `Nothing was written. oldText: "${excerpt}"`
        );
      }

      const write = await ctx.api.updateFile(lockPath, working);
      return {
        success: true
        , path: lockPath
        , applied: pairs.length
        , mtime: write.mtime
        , hash: write.hash
      };
    }
    default:
      throw new Error(`Unknown edit action: ${action}`);
  }
  });
}
