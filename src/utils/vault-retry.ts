/**
 * Folder creation and the sync-conflict retry wrapper for vault writes.
 */
import { App } from 'obsidian';
import { Debug } from './debug';

export async function ensureDirectoryExists(app: App, dirPath: string) {
  const parts = dirPath.split('/').filter(part => part);
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(currentPath)) {
      await createFolderWithRetry(app, currentPath);
    }
  }
}

export async function createFolderWithRetry(app: App, folderPath: string): Promise<void> {
  await withVaultRetry(
    async () => {
      await app.vault.createFolder(folderPath);
    },
    'folder creation',
    300 // Base delay for folder operations
  );
}

/**
 * Universal retry mechanism for Vault operations that may conflict with sync processes
 * Handles iCloud Drive, OneDrive, Dropbox, and other sync service timing issues
 *
 * @param operation - Async function to execute with retry logic
 * @param operationType - Human-readable description for logging
 * @param baseDelayMs - Base delay in milliseconds (exponentially increased per retry)
 * @param maxRetries - Maximum number of retry attempts
 * @returns Result of the operation
 */
export async function withVaultRetry<T>(
  operation: () => Promise<T>,
  operationType: string,
  baseDelayMs: number = 500,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      // Check if this is a sync-related conflict error
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSyncConflictError = errorMessage && (
        errorMessage.includes('already exists') ||
        errorMessage.includes('file exists') ||
        errorMessage.includes('folder exists') ||
        errorMessage.includes('EEXIST') ||
        errorMessage.includes('ENOENT') || // File disappeared during sync
        errorMessage.includes('EBUSY') ||  // File locked by sync process
        errorMessage.includes('EPERM')     // Permission denied during sync
      );

      if (isSyncConflictError && attempt < maxRetries - 1) {
        // Exponential backoff: allow time for sync processes to stabilize
        const delay = Math.pow(2, attempt) * baseDelayMs;
        Debug.log(`${operationType} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms... Error: ${errorMessage}`);
        // Backoff delay; window is aliased to globalThis in the Jest node env.
        await new Promise(resolve => window.setTimeout(resolve, delay));
        continue;
      }

      // If it's the final attempt or not a sync-related error, re-throw
      throw error;
    }
  }

  // This should never be reached due to the loop logic, but TypeScript needs it
  throw new Error(`Failed ${operationType} after ${maxRetries} attempts`);
}
