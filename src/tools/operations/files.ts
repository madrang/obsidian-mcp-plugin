/**
 * Files operation handler (ADR-202, #199).
 *
 * Every files action writes: create, delete, move, copy, split, concat. The
 * read-side cases (folder, read, search, fragments) share these handlers.
 * The router reaches them through the view operation, and it passes itself
 * as the RouterContext, so `ctx.api` and `ctx.app` are the same instances
 * as the router's.
 */
import { Debug } from '../../utils/debug';
import { isImageFile, ObsidianFileResponse } from '../../types/obsidian';
import { readFileWithFragments } from '../../utils/file-reader';
import { ValidationException } from '../../validation/input-validator';
import { SecurityError } from '../../security';
import { RouterContext } from './router-context';
import { Params, paramStr, paramNum, paramBool, requireParamStr, readPageArgs } from './shared';
import { FileLockManager } from '../../utils/file-lock';
import { contentPage, jsonSize, CONTENT_PAGE_DEFAULT_SIZE } from '../../utils/content-page';

/** Fetch cap for the folder universe before the content-budget window cuts it. */
const FOLDER_FETCH_ALL = 1000000;
/** Fetch cap for search results before the content-budget window cuts them. */
const SEARCH_FETCH_CAP = 5000;

type FragmentStrategy = 'auto' | 'adaptive' | 'proximity' | 'structure';

/**
 * Resolve the caller-facing fragment strategy onto the internal one.
 *
 * 'structure' cuts on the document's own headings and paragraphs. It never does
 * embedding or vector similarity, which the index does not implement.
 */
function resolveFragmentStrategy(strategy: string | undefined): FragmentStrategy {
  if (strategy === 'structure') return 'structure';
  if (strategy === 'adaptive' || strategy === 'proximity') return strategy;
  return 'auto';
}

/**
 * Extension of a vault path, including the leading dot ('' when there is none).
 * A leading dot is not an extension: '.gitignore' has none.
 */
function extensionOf(path: string): string {
  const base = path.substring(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.substring(dot) : '';
}

/**
 * The actions the files tool owns — every one writes. list and
 * read/search/fragments live in the view tool. Their cases below are
 * reached through those operations.
 */
export const FILES_ACTIONS = ['create', 'delete', 'move', 'copy', 'split', 'concat'] as const;

export async function executeFilesOperation(ctx: RouterContext, action: string, params: Params): Promise<unknown> {
    switch (action) {
      case 'folder': {
        // `path` names the folder to list. "/" means the vault root.
        const dirParam = paramStr(params, 'path');
        const directory = dirParam === '/' ? undefined : dirParam;
        // A glob filter. Blank means absent.
        const pattern = paramStr(params, 'pattern')?.trim() || undefined;

        // Use paginated list if page parameters are provided, or when a
        // pattern filters the listing: the structured response then carries
        // the pattern and the next-page hint can reproduce the filtered call.
        //
        // When paginating inside a specific directory, recurse so the
        // agent sees the same universe of files as the non-paginated
        // call — page N gives the Nth slice of the recursive listing,
        // not a level-only folder enumeration. The root case is
        // already recursive (getAllLoadedFiles), so we leave
        // recursive=false there. The listFilesPaginated call routes
        // through the same path regardless.
        if (pattern !== undefined || params.page || params.pageSize || params.limit) {
          const { page, pageSize, limit } = readPageArgs(params, 'view.folder');
          const recursive = directory !== undefined;
          // Fetch the full filtered universe, then window it by content
          // budget. The non-paginated path already returns the whole vault,
          // so this changes nothing about worst-case work.
          const universe = await ctx.api.listFilesPaginated(directory, 1, FOLDER_FETCH_ALL, recursive, pattern);
          const windowed = contentPage('view.folder', universe.files, { page, pageSize, limit }, jsonSize);
          return {
            ...universe
            , files: windowed.items
            , page: windowed.page
            , pageSize: windowed.pageSize
            , ...(limit !== undefined ? { limit } : {})
            , totalPages: windowed.totalPages
            , hasMore: windowed.hasMore
          };
        }

        // Fallback to simple list for backwards compatibility
        return await ctx.api.listFiles(directory);
      }
      case 'read': {
        const path = paramStr(params, 'path') ?? '';
        const strategy = paramStr(params, 'strategy') !== undefined
          ? resolveFragmentStrategy(paramStr(params, 'strategy'))
          : undefined;
        const { page, pageSize, limit } = readPageArgs(params, 'view.read');
        return await readFileWithFragments(ctx.api, ctx.fragmentRetriever, {
          path
          , returnFullFile: paramBool(params, 'returnFullFile')
          , page
          , pageSize
          , limit
          , query: paramStr(params, 'query')
          , strategy
        });
      }
      case 'fragments': {
        // Dedicated fragment search. When `path` is supplied it scopes the search to that
        // one file. Previously it was only ever read as a fallback *query* string.
        // Naming a file then returned passages from other files, which the caller
        // could easily attribute to the file it asked about.
        const fragmentPath = paramStr(params, 'path');
        const fragmentQuery = paramStr(params, 'query') ?? fragmentPath ?? '';

        // Skip indexing if no query provided
        if (!fragmentQuery || fragmentQuery.trim().length === 0) {
          return {
            result: []
            , context: {
              operation: 'view'
              , action: 'fragments'
              , error: 'No query provided for fragment search'
            }
          };
        }

        try {
          const indexFile = async (filePath: string): Promise<void> => {
            if (!filePath || !filePath.endsWith('.md')) return;
            try {
              const fileResponse = await ctx.api.getFile(filePath);
              let content: string;

              if (typeof fileResponse === 'string') {
                content = fileResponse;
              } else if (fileResponse && typeof fileResponse === 'object' && 'content' in fileResponse) {
                content = fileResponse.content;
              } else {
                return;
              }

              ctx.fragmentRetriever.indexDocument(`file:${filePath}`, filePath, content);
            } catch (e) {
              // Skip files that cannot be indexed
              Debug.log(`Skipping file during fragment indexing:`, e);
            }
          };

          if (fragmentPath) {
            // Scoped to one file: index just that file. Searching the vault to decide what
            // to index would be wasted work, and could fail to index the very file named.
            await indexFile(fragmentPath);
          } else {
            // Only index files that match the query to avoid indexing entire vault
            // This is a lazy indexing approach - index on demand
            const searchResults = await ctx.api.searchPaginated(fragmentQuery, 1, 20, 'combined');

            if (searchResults && searchResults.results && searchResults.results.length > 0) {
              for (const result of searchResults.results.slice(0, 20)) { // Limit to first 20 files
                await indexFile(result.path);
              }
            }
          }

          const { page: fragmentPage, pageSize: fragmentBudget, limit: fragmentLimit } = readPageArgs(params, 'view.fragments');

          // The retriever caps what it fetches. With a limit the universe is
          // the limit itself. Without one, over-fetch for the requested page
          // and let the budget window cut. A full fetch means more pages may
          // exist.
          const fetchCap = fragmentLimit ?? Math.max((fragmentPage ?? 1) * 50, 50);

          // Search for fragments in indexed documents
          const fragmentResponse = ctx.fragmentRetriever.retrieveFragments(fragmentQuery, {
            strategy: resolveFragmentStrategy(paramStr(params, 'strategy'))
            , maxFragments: fetchCap
            , scopePath: fragmentPath
          });

          if (fragmentResponse && Array.isArray(fragmentResponse.result)) {
            const windowed = contentPage('view.fragments', fragmentResponse.result, { page: fragmentPage, pageSize: fragmentBudget, limit: fragmentLimit }, jsonSize);
            return {
              ...fragmentResponse
              , result: windowed.items
              , page: windowed.page
              , pageSize: windowed.pageSize
              , ...(fragmentLimit !== undefined ? { limit: fragmentLimit } : {})
              , totalFragments: windowed.totalItems
              , totalPages: windowed.totalPages
              , hasMore: windowed.hasMore || (fragmentLimit === undefined && fragmentResponse.result.length === fetchCap)
            };
          }

          return fragmentResponse;
        } catch (error) {
          Debug.error('Fragment search failed:', error);
          return {
            result: []
            , context: {
              operation: 'view'
              , action: 'fragments'
              , error: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }
      case 'create': {
        const path = requireParamStr(params, 'path', 'files.create');
        // Empty content is a legitimate "touch" — only the path is required.
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
          // A rejected path is not a "does not exist yet" — see the move case.
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
      case 'delete': {
        const path = requireParamStr(params, 'path', 'files.delete');
        return await ctx.api.deleteFile(path);
      }
      case 'search': {
        // Validate query
        const queryStr = paramStr(params, 'query');
        if (!queryStr || queryStr.trim().length === 0) {
          return {
            query: queryStr || ''
            , page: 1
            , pageSize: 10
            , totalResults: 0
            , totalPages: 0
            , results: []
            , method: 'error'
            , error: 'Search query is required'
            , hint: 'Please provide a search query. Examples: "keyword", "tag:#example", "file:name.md"'
          };
        }

        // Use advanced search with ranking and snippets
        try {
          const { page, pageSize, limit } = readPageArgs(params, 'view.search');
          const pageBudget = pageSize ?? CONTENT_PAGE_DEFAULT_SIZE;
          // One strategy parameter for the whole view tool. Only the search
          // strategies apply here. Anything else (a fragment strategy, auto,
          // or nothing) falls back to combined.
          const requestedStrategy = paramStr(params, 'strategy');
          const strategy: 'filename' | 'content' | 'combined' =
            requestedStrategy === 'filename' || requestedStrategy === 'content' || requestedStrategy === 'combined'
              ? requestedStrategy
              : 'combined';

          // Snippet sizing: with a limit, each item gets an even share of
          // the page budget, capped at the proven 300-char excerpt. Below
          // 100 chars per item the snippet is noise: return the matches with
          // metadata only instead.
          const snippetSpan = limit !== undefined ? Math.floor(pageBudget * 0.75 / limit) : 300;

          // Build search options from new parameters
          const searchOptions: {
            ranked?: boolean;
            includeSnippets?: boolean;
            snippetLength?: number;
            maxResults?: number;
          } = {};

          if (params.ranked !== undefined) {
            searchOptions.ranked = Boolean(params.ranked);
          }
          if (snippetSpan >= 100) {
            searchOptions.snippetLength = snippetSpan;
          } else {
            searchOptions.includeSnippets = false;
          }

          // Fetch enough items for the requested page: a hit is never smaller
          // than ~40 serialized chars, so the page always ends inside the
          // fetch. With a limit the universe is the limit itself.
          const fetchCount = Math.min(limit ?? Math.ceil((page ?? 1) * pageBudget / 40), SEARCH_FETCH_CAP);
          searchOptions.maxResults = fetchCount;

          const found = await ctx.api.searchPaginated(
            queryStr,
            1,
            fetchCount,
            strategy,
            searchOptions
          );

          const windowed = contentPage('view.search', found.results, { page, pageSize, limit }, jsonSize);
          return {
            ...found
            , results: windowed.items
            , page: windowed.page
            , pageSize: windowed.pageSize
            , ...(limit !== undefined ? { limit } : {})
            , totalPages: windowed.totalPages
            , pageStart: windowed.pageStart
            , pageEnd: windowed.pageEnd
            , hasMore: windowed.hasMore || (limit === undefined && found.results.length === fetchCount)
          };
        } catch (searchError) {
          Debug.error('Search failed:', searchError);

          // Try fallback with basic search strategy
          try {
            const fallbackResults = await ctx.api.searchPaginated(
              queryStr,
              1,
              10,
              'filename' // Use simple filename search as fallback
            );

            if (fallbackResults && fallbackResults.results && fallbackResults.results.length > 0) {
              return {
                ...fallbackResults
                , method: 'filename_fallback'
                , warning: 'Using filename-only search due to advanced search failure'
              };
            }
          } catch (fallbackError) {
            Debug.error('Fallback search also failed:', fallbackError);
          }

          // Return error with helpful information
          return {
            query: queryStr
            , page: 1
            , pageSize: 10
            , totalResults: 0
            , totalPages: 0
            , results: []
            , method: 'error'
            , error: searchError instanceof Error ? searchError.message : String(searchError)
            , hint: 'Try simplifying your query or check if the vault is accessible'
          };
        }
      }
      // A destination without a directory renames in place, one with a
      // directory relocates (vault-root-relative, with or without a leading
      // slash) — one parameter covers both.
      case 'move': {
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
      
      case 'copy': {
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
      
      case 'split': {
        const path = paramStr(params, 'path');
        const splitBy = paramStr(params, 'splitBy');
        const outputPattern = paramStr(params, 'outputPattern');
        const outputDirectory = paramStr(params, 'outputDirectory');

        if (!path || !splitBy) {
          throw new Error('Both path and splitBy are required for split operation');
        }

        // Get the source file
        const sourceFile = await ctx.api.getFile(path);
        if (!sourceFile) {
          throw new Error(`File not found: ${path}`);
        }

        if (isImageFile(sourceFile)) {
          throw new Error('Cannot split image files');
        }

        // Split the content
        const splitFiles = splitContent(sourceFile.content, params);
        
        // Create output files
        const createdFiles = [];
        const pathParts = path.split('/');
        const filename = pathParts.pop() || '';
        const dir = outputDirectory || pathParts.join('/');
        const [basename, ext] = filename.includes('.') 
          ? [filename.substring(0, filename.lastIndexOf('.')), filename.substring(filename.lastIndexOf('.'))]
          : [filename, ''];
        
        // Name every output up front, then refuse on any collision before
        // the first write: a refused split writes nothing. Without the
        // pre-flight, outputs written before the collision stayed on disk.
        const outputPaths = splitFiles.map((_, i) => {
          const pattern = outputPattern || '{filename}-{index}{ext}';
          const outputFilename = pattern
            .replace('{filename}', basename)
            .replace('{index}', String(i + 1).padStart(3, '0'))
            .replace('{ext}', ext);
          return dir ? `${dir}/${outputFilename}` : outputFilename;
        });

        const seenPaths = new Set<string>();
        for (const outputPath of outputPaths) {
          if (seenPaths.has(outputPath)) {
            throw new Error(`Split refused: the output pattern names the same file twice: ${outputPath}`);
          }
          seenPaths.add(outputPath);
          const stat = await ctx.api.getFileStat(outputPath);
          if (stat.exists) {
            throw new Error(`Split refused: output file already exists: ${outputPath}`);
          }
        }

        for (let i = 0; i < splitFiles.length; i++) {
          const outputPath = outputPaths[i];
          await ctx.api.createFile(outputPath, splitFiles[i].content);

          createdFiles.push({
            path: outputPath
            , lines: splitFiles[i].content.split('\n').length
            , size: splitFiles[i].content.length
          });
        }
        
        return {
          success: true
          , sourceFile: path
          , createdFiles
          , totalFiles: createdFiles.length
          , workflow: {
            message: `Successfully split ${path} into ${createdFiles.length} files`
            , suggested_next: [
              {
                description: 'View one of the split files'
                , command: `view(action='read', path='${createdFiles[0]?.path}')`
              }
              , {
                description: 'List all created files'
                , command: `view(action='folder', directory='${dir || '.'}')`
              }
              , {
                description: 'Combine files back together'
                , command: `edit(action='concat', paths=${JSON.stringify(createdFiles.map(f => f.path))}, destination='${path}-combined${ext}')`
              }
            ]
          }
        };
      }
      
      case 'concat':
        return combineFiles(ctx, params);

      default:
        throw new Error(`Unknown files action: ${action}`);
    }
  }
  
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

function splitContent(content: string, params: Params): Array<{ content: string }> {
    const splitBy = paramStr(params, 'splitBy');
    const delimiter = paramStr(params, 'delimiter');
    const level = paramNum(params, 'level');
    const linesPerFile = paramNum(params, 'linesPerFile');
    const maxSize = paramNum(params, 'maxSize');
    const splitFiles: Array<{ content: string }> = [];
    
    switch (splitBy) {
      case 'heading': {
        // Split by markdown headings
        const headingLevel = level || 1;
        const headingRegex = new RegExp(`^${'#'.repeat(headingLevel)}\\s+.+$`, 'gm');
        const matches = Array.from(content.matchAll(headingRegex));
        
        if (matches.length === 0) {
          // No headings found, return original content
          return [{ content }];
        }
        
        // Split content at each heading
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          const nextMatch = matches[i + 1];
          const startIndex = match.index || 0;
          const endIndex = nextMatch ? nextMatch.index : content.length;
          
          if (i === 0 && startIndex > 0) {
            // Content before first heading
            splitFiles.push({ content: content.substring(0, startIndex).trim() });
          }
          
          const section = content.substring(startIndex, endIndex).trim();
          if (section) {
            splitFiles.push({ content: section });
          }
        }
        break;
      }
      
      case 'delimiter': {
        // Split by custom delimiter
        const delim = delimiter || '---';
        const parts = content.split(delim);
        
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed) {
            splitFiles.push({ content: trimmed });
          }
        }
        break;
      }
      
      case 'lines': {
        // Split by line count
        const lines = content.split('\n');
        const chunkSize = linesPerFile || 100;
        
        for (let i = 0; i < lines.length; i += chunkSize) {
          const chunk = lines.slice(i, i + chunkSize).join('\n');
          if (chunk.trim()) {
            splitFiles.push({ content: chunk });
          }
        }
        break;
      }
      
      case 'size': {
        // Split by character count, preserving word boundaries
        const max = maxSize || 10000;
        let currentPos = 0;
        
        while (currentPos < content.length) {
          let endPos = Math.min(currentPos + max, content.length);
          
          // If we're not at the end, try to find a good break point
          if (endPos < content.length) {
            // Look for paragraph break first
            const paragraphBreak = content.lastIndexOf('\n\n', endPos);
            if (paragraphBreak > currentPos && paragraphBreak > endPos - 1000) {
              endPos = paragraphBreak;
            } else {
              // Look for line break
              const lineBreak = content.lastIndexOf('\n', endPos);
              if (lineBreak > currentPos && lineBreak > endPos - 200) {
                endPos = lineBreak;
              } else {
                // Look for sentence end
                const sentenceEnd = content.lastIndexOf('. ', endPos);
                if (sentenceEnd > currentPos && sentenceEnd > endPos - 100) {
                  endPos = sentenceEnd + 1;
                } else {
                  // Look for word boundary
                  const wordBoundary = content.lastIndexOf(' ', endPos);
                  if (wordBoundary > currentPos) {
                    endPos = wordBoundary;
                  }
                }
              }
            }
          }
          
          const chunk = content.substring(currentPos, endPos).trim();
          if (chunk) {
            splitFiles.push({ content: chunk });
          }
          currentPos = endPos;
          
          // Skip whitespace at the beginning of next chunk
          while (currentPos < content.length && /\s/.test(content[currentPos])) {
            currentPos++;
          }
        }
        break;
      }
      
      default:
        throw new Error(`Unknown split strategy: ${splitBy}`);
    }
    
    return splitFiles.length > 0 ? splitFiles : [{ content }];
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
