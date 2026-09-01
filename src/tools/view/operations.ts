/**
 * View operation handler (ADR-202). grep, lines, window, and active live
 * here. folder/read/search/fragments run the shared file handlers in
 * operations/files.ts, and the view definition delegates to them.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramNum, requireParamStr } from '../shared';
import { isImageFile } from '../../types/obsidian';
import { grepContent, GrepMatch } from '../../utils/grep-search';
import { isResourceUri } from '../../resources/registry';
import { readResourceContent } from './resource-read';

export async function executeViewOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
  switch (action) {
    case 'grep': {
      const pattern = requireParamStr(params, 'pattern', 'view.grep');
      // The same regex safety gate view.search applies (complexity + length).
      const regexCheck = ctx.validator.validate('search.query', { query: pattern });
      if (!regexCheck.valid) {
        throw new Error(`view.grep: ${regexCheck.errors?.map(e => e.message).join(', ')}`);
      }
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'g');
      } catch (error: unknown) {
        throw new Error(
          `view.grep: invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const maxResults = paramNum(params, 'maxResults') ?? 200;
      // `path` names one file or a folder subtree; a file probe tells them
      // apart (a folder never resolves as a file — same probe files.copy
      // uses).
      const scope = paramStr(params, 'path');
      if (!ctx.app) {
        throw new Error('view.grep requires the Obsidian app context');
      }

      let paths: string[];
      if (scope) {
        let isFile = false;
        try {
          await ctx.api.getFile(scope);
          isFile = true;
        } catch {
          isFile = false;
        }
        if (isFile) {
          paths = [scope];
        } else {
          paths = ctx.app.vault.getMarkdownFiles().map(f => f.path);
          if (scope !== '/') {
            const prefix = scope.endsWith('/') ? scope : `${scope}/`;
            paths = paths.filter(p => p.startsWith(prefix));
          }
          const ignore = ctx.api.getIgnoreManager();
          if (ignore) paths = ignore.filterPaths(paths);
        }
      } else {
        paths = ctx.app.vault.getMarkdownFiles().map(f => f.path);
        const ignore = ctx.api.getIgnoreManager();
        if (ignore) paths = ignore.filterPaths(paths);
      }

      const matches: GrepMatch[] = [];
      let filesScanned = 0;
      let truncated = false;
      for (const p of paths) {
        const remaining = maxResults - matches.length;
        if (remaining <= 0) break;
        let content: string;
        try {
          // Through the session's API, so path validation and the scoped-token
          // folder boundary apply per file. An excluded path answers the same
          // way getFile answers elsewhere: not visible to this caller.
          const file = await ctx.api.getFile(p);
          if (isImageFile(file)) continue;
          content = typeof file === 'string' ? file : file.content;
        } catch {
          continue;
        }
        filesScanned++;
        // Ask for one match past the remaining budget: a real dropped match
        // is what sets truncated, not the budget merely being reached.
        const found = grepContent(p, content, regex, remaining + 1);
        if (found.length > remaining) {
          matches.push(...found.slice(0, remaining));
          truncated = true;
          break;
        }
        matches.push(...found);
      }

      return {
        pattern
        , matches
        , totalMatches: matches.length
        , truncated
        , filesScanned
      };
    }

    case 'lines': {
      // Exact range addressing: the caller owns the bounds, unlike window's
      // derived ones. A partial read carries no stats — only a complete
      // view.read returns mtime/hash.
      const linesPath = requireParamStr(params, 'path', 'view.lines');
      const startLine = paramNum(params, 'startLine');
      const endLine = paramNum(params, 'endLine');
      // Checked before any vault call, so a malformed range never reaches
      // getFile (same boundary rule as requireParamStr, #210).
      if (
        startLine === undefined || endLine === undefined ||
        !Number.isInteger(startLine) || !Number.isInteger(endLine) ||
        startLine < 1 || endLine < startLine
      ) {
        throw new Error(
          `view.lines requires 'startLine' and 'endLine' as integers with 1 <= startLine <= endLine ` +
          `(got startLine: ${JSON.stringify(params.startLine) ?? 'missing'}, endLine: ${JSON.stringify(params.endLine) ?? 'missing'}).`
        );
      }

      // Resource URIs serve computed text: no vault file, no image probe.
      const resource = isResourceUri(linesPath) ? readResourceContent(ctx, linesPath) : undefined;
      let content: string;
      let resultPath: string;
      if (resource) {
        content = resource.text;
        resultPath = resource.uri;
      } else {
        const file = await ctx.api.getFile(linesPath);
        if (isImageFile(file)) {
          throw new Error('Cannot view lines of image files');
        }
        content = typeof file === 'string' ? file : file.content;
        resultPath = linesPath;
      }
      const allLines = content.split('\n');
      if (startLine > allLines.length) {
        // A start past the end means the address is stale — the caller is
        // working from an outdated view of the file.
        throw new Error(
          `view.lines: startLine ${startLine} is past the end of ${linesPath} ` +
          `(the file has ${allLines.length} lines). Re-read the file: the address is stale.`
        );
      }
      const clampedEnd = Math.min(endLine, allLines.length);

      return {
        path: resultPath
        , lines: allLines.slice(startLine - 1, clampedEnd)
        , startLine
        , endLine: clampedEnd
        , totalLines: allLines.length
      };
    }

    case 'window': {
      // View a portion of a file
      const viewPath = requireParamStr(params, 'path', 'view.window');
      // Resource URIs serve computed text: no vault file, no image probe.
      const resource = isResourceUri(viewPath) ? readResourceContent(ctx, viewPath) : undefined;
      let content: string;
      let resultPath: string;
      if (resource) {
        content = resource.text;
        resultPath = resource.uri;
      } else {
        const file = await ctx.api.getFile(viewPath);
        if (isImageFile(file)) {
          throw new Error('Cannot view window of image files');
        }
        content = typeof file === 'string' ? file : file.content;
        resultPath = viewPath;
      }
      const lines = content.split('\n');
      const searchText = paramStr(params, 'searchText');

      let centerLine = paramNum(params, 'lineNumber') || 1;

      // If search text provided, find it
      if (searchText && !params.lineNumber) {
        const { findFuzzyMatches } = await import('../../utils/fuzzy-match.js');
        const matches = findFuzzyMatches(content, searchText, 0.6);
        if (matches.length > 0) {
          centerLine = matches[0].lineNumber;
        }
      }

      // Calculate window
      const windowSize = paramNum(params, 'windowSize') || 20;
      const halfWindow = Math.floor(windowSize / 2);
      const startLine = Math.max(1, centerLine - halfWindow);
      const endLine = Math.min(lines.length, centerLine + halfWindow);

      return {
        path: resultPath
        , lines: lines.slice(startLine - 1, endLine)
        , startLine
        , endLine
        , totalLines: lines.length
        , centerLine
        , searchText
      };
    }

    case 'active':
      // Add timeout to prevent hanging when no file is active
      try {
        const timeoutPromise = new Promise((_, reject) =>
          window.setTimeout(() => reject(new Error('Timeout: No active file in Obsidian. Please open a file first.')), 5000)
        );
        const activeResult = await Promise.race([
          ctx.api.getActiveFile()
          , timeoutPromise
        ]);
        return activeResult;
      } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes('Timeout')) {
          throw error;
        }
        // Re-throw original error if not timeout
        throw error;
      }

    default:
      throw new Error(`Unknown view action: ${action}`);
  }
}
