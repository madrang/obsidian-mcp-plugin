import { createHash } from 'crypto';

/**
 * SHA-256 content hash, first 16 hex chars (64 bits). The value the edit
 * tool's ifHash precondition accepts. Computed the same way everywhere it
 * is produced: complete-file reads (which expose it to the caller) and the
 * internal stat used at write time to verify it.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}
