export interface ObsidianConfig {
  apiKey: string;
  apiUrl?: string;
  vaultName?: string;
}

export interface ObsidianFile {
  path: string;
  content: string;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
  /** Last modification time (ms epoch), from TFile.stat. Present on reads
   * through getFile; a complete view.read exposes it so the caller can echo
   * it back as the edit ifUnmodifiedSince precondition. */
  mtime?: number;
}

export interface ObsidianImageFile {
  path: string;
  mimeType: string;
  base64Data: string;
}

export type ObsidianFileResponse = ObsidianFile | ObsidianImageFile;

/** Metadata-only file stat. The mtime and hash feed the edit tool's
 * ifUnmodifiedSince / ifHash write preconditions. */
export interface FileStatResponse {
  path: string;
  exists: boolean;
  size?: number;
  mtime?: number;
  ctime?: number;
  lineCount?: number;
  /** First 16 hex chars of the SHA-256 of the content. Same value ifHash accepts */
  hash?: string;
}

export function isImageFile(file: ObsidianFileResponse): file is ObsidianImageFile {
  return 'mimeType' in file && 'base64Data' in file;
}

export interface SearchResult {
  path: string;
  content: string;
  score?: number;
  context?: string;
}