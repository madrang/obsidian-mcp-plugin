import { ObsidianAPI } from './obsidian-api';
import { isImageFile } from '../types/obsidian';
import { UniversalFragmentRetriever } from '../indexing/fragment-retriever';
import { contentHash } from './content-hash';
import { contentPage, jsonSize, CONTENT_PAGE_DEFAULT_SIZE, FRAGMENT_FETCH_CAP } from './content-page';

/**
 * Character budget that decides whole-file vs. paginated reads (ADR-203).
 *
 * Size-based on purpose: a line count is an invalid proxy for context cost
 * (1500 short lines vs 1500 long lines differ by orders of magnitude). Only
 * the *bookends* are line-based, so `edit.at_line` keeps working on a large
 * file. ~50k chars ≈ ~12k tokens — generous enough that the overwhelming
 * majority of notes return whole in one load.
 */
export const READ_PAGE_CHARS = 50000;

interface FileReadOptions {
  path: string;
  /** Explicit whole-large-file override (ADR-203): full verbatim regardless of size. */
  returnFullFile?: boolean;
  /** Sequential page (1-based) for large files that exceed READ_PAGE_CHARS. With query, the fragment page. */
  page?: number;
  /** Page content size in characters, for file pages and fragment pages (default READ_PAGE_CHARS). */
  pageSize?: number;
  /** Item cap for fragment pages when query is present. */
  limit?: number;
  query?: string;
  strategy?: 'auto' | 'adaptive' | 'proximity' | 'structure';
  /** Internal override: a hard fragment cap with no pagination. */
  maxFragments?: number;
}

interface FileReadResult {
  path?: string;
  content?: unknown;
  metadata?: unknown;
  frontmatter?: unknown;
  tags?: unknown;
  /** Last modification time (ms epoch). Present only on a complete read —
   * the edit ifUnmodifiedSince precondition must not be obtainable without
   * the content. */
  mtime?: number;
  /** SHA-256 content hash (16 hex chars). Same rule as mtime. */
  hash?: string;
  originalContentLength?: number;
  pagination?: {
    paginated: boolean;
    page: number;
    pageLineStart: number;
    pageLineEnd: number;
    totalLines: number;
    bytes: number;
    hasMore: boolean;
    nextPage: string | null;
    oversizedLine?: boolean;
    beyondEnd?: boolean;
  };
  fragmentMetadata?: {
    totalFragments: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
    limit?: number;
    strategy: string;
    query: string;
  };
  workflow?: unknown;
  efficiency_hints?: unknown;
  warning?: string;
  // For image files
  base64Data?: string;
  mimeType?: string;
}

/**
 * Build one page: the longest run of whole lines (starting at `startIdx`,
 * 0-based) whose joined size stays within `pageChars`. A single line
 * larger than the budget is returned whole as its own page (never split).
 */
function buildPage(lines: string[], startIdx: number, pageChars: number): {
  text: string;
  lineStart: number;
  lineEnd: number;
  nextIdx: number;
  oversizedLine: boolean;
} {
  const parts: string[] = [];
  let size = 0;
  let i = startIdx;
  let oversizedLine = false;
  while (i < lines.length) {
    const ln = lines[i];
    const candidate = parts.length === 0 ? ln.length : size + 1 + ln.length;
    if (candidate > pageChars && parts.length > 0) break;
    if (candidate > pageChars && parts.length === 0) oversizedLine = true;
    parts.push(ln);
    size = candidate;
    i++;
    if (oversizedLine) break;
  }
  return {
    text: parts.join('\n')
    , lineStart: startIdx + 1
    , lineEnd: i // 1-based inclusive end == count of lines consumed
    , nextIdx: i
    , oversizedLine,
  };
}

/**
 * Shared file reading logic (ADR-203).
 *
 * Faithful by default, never context-breaking:
 *  - fragment params (query/strategy, paged with page/pageSize) → fragment retrieval
 *  - returnFullFile:true → entire file verbatim (explicit large override)
 *  - fits READ_PAGE_CHARS → entire file verbatim, one load (common case)
 *  - a page past the last one → empty content, `beyondEnd` marker, a warning
 *    naming the last page — never an error, never a second complete read
 *  - exceeds budget → bookended page 1 (or `page` N): one contiguous
 *    verbatim block + line bookends so edit.at_line still works
 *
 * Content is byte-exact in every branch (never flattened); the structured
 * envelope no longer double-encodes the body.
 */
export async function readFileWithFragments(
  api: ObsidianAPI,
  fragmentRetriever: UniversalFragmentRetriever,
  options: FileReadOptions
): Promise<FileReadResult> {
  const { path, returnFullFile, page, pageSize, limit, query, strategy, maxFragments } = options;

  const fileResponse = await api.getFile(path);

  // Image / binary: passthrough unchanged
  if (isImageFile(fileResponse)) {
    return fileResponse;
  }

  // Extract verbatim content + metadata (metadata WITHOUT a copy of the body)
  let fileContent: string;
  let metaNoBody: Record<string, unknown> = {};
  let frontmatter: unknown;
  let tags: unknown;
  let fileMtime: unknown;

  if (typeof fileResponse === 'string') {
    fileContent = fileResponse;
  } else if (fileResponse && typeof fileResponse === 'object' && 'content' in fileResponse) {
    const fc = (fileResponse as { content: unknown }).content;
    if (typeof fc !== 'string') {
      return fileResponse; // image/binary structured
    }
    fileContent = fc;
    // Strip the body so it is not embedded twice in the envelope (ADR-203 §3).
    // mtime is held back too: it rejoins the response only on a complete
    // read below, never as metadata on a page or fragment response.
    const { content: _body, frontmatter: fm, tags: tg, mtime: readMtime, ...rest } =
      fileResponse as unknown as Record<string, unknown>;
    void _body;
    metaNoBody = rest;
    fileMtime = readMtime;
    frontmatter = fm;
    tags = tg;
  } else {
    return fileResponse;
  }

  const totalChars = fileContent.length;
  const pageChars = pageSize ?? READ_PAGE_CHARS;
  const lines = fileContent.split('\n');
  const totalLines = lines.length;

  // 1. Explicit fragment retrieval (unchanged behaviour)
  const wantsFragments =
    query !== undefined || strategy !== undefined || maxFragments !== undefined;
  if (wantsFragments) {
    const docId = `file:${path}`;
    fragmentRetriever.indexDocument(docId, path, fileContent);
    const fragmentQuery = query || path.split('/').pop()?.replace('.md', '') || '';
    // Same pagination as the fragments action: pageSize is the page content
    // budget in characters, limit the item cap. `page` means the fragment
    // page here, never the file page.
    const fragmentPage = page ?? 1;
    const fragmentLimit = limit ?? maxFragments;
    const fragmentBudget = pageSize ?? CONTENT_PAGE_DEFAULT_SIZE;
    const fetchCap = fragmentLimit ?? FRAGMENT_FETCH_CAP;
    const fragmentResponse = fragmentRetriever.retrieveFragments(fragmentQuery, {
      strategy: strategy || 'auto'
      , maxFragments: fetchCap,
    });
    const windowed = contentPage('view.read', fragmentResponse.result, { page: fragmentPage, pageSize: fragmentBudget, limit: fragmentLimit }, jsonSize);
    return {
      path
      , ...metaNoBody
      , frontmatter
      , tags
      , content: windowed.items
      , originalContentLength: totalChars
      , fragmentMetadata: {
        totalFragments: windowed.totalItems
        , page: windowed.page
        , pageSize: windowed.pageSize
        , ...(fragmentLimit !== undefined ? { limit: fragmentLimit } : {})
        , hasMore: windowed.hasMore || (fragmentLimit === undefined && fragmentResponse.result.length === fetchCap)
        , strategy: strategy || 'auto'
        , query: fragmentQuery,
      }
      , workflow: fragmentResponse.workflow
      , efficiency_hints: fragmentResponse.efficiency_hints,
    };
  }

  // 2. A page request beyond 1 on a file that fits in one page is past the
  // end — same shape as a deep page on a large file, never a second
  // complete read (a page is partial: no mtime, no hash).
  if (!returnFullFile && totalChars <= pageChars && typeof page === 'number' && page > 1) {
    const requested = Math.floor(page);
    return {
      path
      , content: ''
      , frontmatter
      , tags
      , metadata: { ...metaNoBody, totalLines, bytes: totalChars }
      , pagination: {
        paginated: true
        , page: requested
        , pageLineStart: totalLines + 1
        , pageLineEnd: totalLines
        , totalLines
        , bytes: totalChars
        , hasMore: false
        , nextPage: null
        , beyondEnd: true,
      }
      , warning: `Requested page ${requested} is past end of file (file has ${totalLines} lines, last page is 1).`,
    };
  }

  // 3. Whole file, one load — fits the budget OR explicit override
  if (returnFullFile || totalChars <= pageChars) {
    const overrideOnLarge = !!returnFullFile && totalChars > pageChars;
    return {
      path
      , content: fileContent // verbatim, single contiguous string
      // Precondition values (edit ifUnmodifiedSince / ifHash). Attached only
      // here, on the branch that returns the complete file: there is no way
      // to get them without the content.
      , mtime: typeof fileMtime === 'number' ? fileMtime : undefined
      , hash: contentHash(fileContent)
      , frontmatter
      , tags
      , metadata: {
        ...metaNoBody
        , totalLines
        , bytes: totalChars,
      }
      , pagination: {
        paginated: false
        , page: 1
        , pageLineStart: 1
        , pageLineEnd: totalLines
        , totalLines
        , bytes: totalChars
        , hasMore: false
        , nextPage: null,
      }
      , warning: overrideOnLarge
        ? `Returned entire large file verbatim (${totalLines} lines, ${totalChars} bytes) via returnFullFile override.`
        : undefined,
    };
  }

  // 4. Large file, no override, no fragments → bookended page
  const requested = typeof page === 'number' && page >= 1 ? Math.floor(page) : 1;
  let idx = 0;
  let cur = 1;
  let built = buildPage(lines, idx, pageChars);
  while (cur < requested && built.nextIdx < lines.length) {
    idx = built.nextIdx;
    cur++;
    built = buildPage(lines, idx, pageChars);
  }

  // Requested a page past EOF
  if (cur < requested) {
    return {
      path
      , content: ''
      , frontmatter
      , tags
      , metadata: { ...metaNoBody, totalLines, bytes: totalChars }
      , pagination: {
        paginated: true
        , page: requested
        , pageLineStart: totalLines + 1
        , pageLineEnd: totalLines
        , totalLines
        , bytes: totalChars
        , hasMore: false
        , nextPage: null
        , beyondEnd: true,
      }
      , warning: `Requested page ${requested} is past end of file (file has ${totalLines} lines, last page is ${cur}).`,
    };
  }

  const hasMore = built.nextIdx < lines.length;
  const nextPageNum = cur + 1;
  return {
    path
    , content: built.text // contiguous verbatim block for this line range
    , frontmatter
    , tags
    , metadata: { ...metaNoBody, totalLines, bytes: totalChars }
    , pagination: {
      paginated: true
      , page: cur
      , pageLineStart: built.lineStart
      , pageLineEnd: built.lineEnd
      , totalLines
      , bytes: totalChars
      , hasMore
      , nextPage: hasMore ? `view.read(path='${path}', page=${nextPageNum})` : null
      , oversizedLine: built.oversizedLine || undefined,
    }
    , warning:
      `Large file (${totalLines} lines, ${totalChars} bytes). Returned page ${cur} ` +
      `(lines ${built.lineStart}-${built.lineEnd}, verbatim). ` +
      (hasMore ? `Use page=${nextPageNum} for more, ` : '') +
      `returnFullFile=true for the whole file, or query/strategy with page/pageSize for fragments. ` +
      `Line numbers are absolute — edit.at_line works on this page.`,
  };
}
