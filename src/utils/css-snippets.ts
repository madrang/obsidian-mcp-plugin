/**
 * The obsidian://snippets/ namespace: CSS snippet files in the vault's
 * config directory (ADR-113).
 *
 * Snippet files sit outside the Obsidian vault index (dot-prefixed config
 * space), so every file access goes through the vault adapter, never
 * getAbstractFileByPath. The security layer lets a snippets URI through
 * its own branch (VaultSecurityManager); the blanket dot-segment rule in
 * SecurePathValidator stays untouched, and a raw .obsidian path from an
 * agent stays rejected. The file name is the only variable part of the
 * namespace, so its shape rules carry the whole containment story.
 *
 * The enabled state lives in the app config, key enabledCssSnippets: an
 * array of snippet ids (file name without the trailing .css). The config
 * API is verified against the live app bundle (obsidian-1.13.7.asar):
 *   getConfig(key)   in-memory value with defaults fallback, deep-copied
 *   setConfig(key)   set + debounced save + "config-changed" event
 * Nothing in the CSS subsystem listens to that event, so a config write
 * persists immediately but applies when Obsidian next reloads the
 * appearance config. The app-config namespace (src/utils/app-config.ts)
 * owns config reads and writes.
 */
import { App } from 'obsidian';

export const SNIPPETS_URI_PREFIX = 'obsidian://snippets/';
const SNIPPETS_BARE_NAMESPACE = 'obsidian://snippets';
const CSS_EXTENSION = '.css';
const MAX_SNIPPET_NAME_LENGTH = 255;

/** Coded refusal or failure from the snippets namespace. */
export class SnippetError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SnippetError';
  }
}

/** True for any URI of the snippets namespace, file or folder form. */
export function isSnippetsUri(path?: string | null): boolean {
  if (!path) return false;
  return path.startsWith(SNIPPETS_URI_PREFIX) || path === SNIPPETS_BARE_NAMESPACE;
}

/** True only for the folder form, the namespace root. */
export function isSnippetsFolderUri(path?: string | null): boolean {
  return path === SNIPPETS_URI_PREFIX || path === SNIPPETS_BARE_NAMESPACE;
}

/**
 * The file-name segment of a snippets URI: one segment, .css suffix, no
 * leading dot, no separators, no traversal.
 */
export function snippetFileNameFromUri(path: string): string {
  if (!path.startsWith(SNIPPETS_URI_PREFIX)) {
    throw new SnippetError(`Not a snippets URI: ${path}`, 'INVALID_SNIPPET_NAME');
  }
  const fileName = path.slice(SNIPPETS_URI_PREFIX.length);
  const valid =
    fileName.length > CSS_EXTENSION.length &&
    fileName.length <= MAX_SNIPPET_NAME_LENGTH &&
    fileName.endsWith(CSS_EXTENSION) &&
    !fileName.startsWith('.') &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    !fileName.includes('..');
  if (!valid) {
    throw new SnippetError(
      `Invalid snippet name "${fileName}": one segment ending in .css, no leading dot, no path separators.`
      , 'INVALID_SNIPPET_NAME'
    );
  }
  return fileName;
}

/** The snippet id the app config uses: the file name without the trailing .css. */
export function snippetId(fileName: string): string {
  return fileName.slice(0, -CSS_EXTENSION.length);
}

/** Vault-internal path of a snippet file. configDir, not a hardcoded .obsidian. */
export function snippetVaultPath(app: App, fileName: string): string {
  return `${app.vault.configDir}/snippets/${fileName}`;
}

/** Enabled state of one snippet, read from the app config. */
export function isSnippetEnabled(app: App, fileName: string): boolean {
  const enabled = (app.vault as unknown as { getConfig(key: string): unknown }).getConfig('enabledCssSnippets');
  return Array.isArray(enabled) && enabled.includes(snippetId(fileName));
}

/**
 * The app's own toggle handler: Set mutation, config persist, and a live
 * style reload in one call (verified in the 1.12.x base package and in
 * obsidian-1.13.7.asar). This is the exact code the Settings UI runs, and
 * the only path that applies a snippet toggle without a restart. Each
 * call re-persists the whole membership, so applying a complete diff
 * converges the config to exactly the written membership.
 *
 * Returns false when this Obsidian build does not expose the handler.
 * Callers then fall back to a plain config write, which applies when the
 * app next loads the appearance config.
 */
export function applySnippetEnabledDelta(app: App, deltas: Array<{ id: string; enabled: boolean }>): boolean {
  const css = (app as unknown as { customCss?: { setCssEnabledStatus(id: string, enabled: boolean): unknown } }).customCss;
  if (!css || typeof css.setCssEnabledStatus !== 'function') {
    return false;
  }
  for (const { id, enabled } of deltas) {
    css.setCssEnabledStatus(id, enabled);
  }
  return true;
}

/** The .css file names in the snippets folder. Empty when the folder is absent. */
export async function listSnippetFiles(app: App): Promise<string[]> {
  const folder = `${app.vault.configDir}/snippets`;
  try {
    // adapter.list answers full vault-relative paths; the namespace speaks
    // bare file names, so the folder prefix comes off here.
    const listing = await app.vault.adapter.list(folder);
    return listing.files
      .filter((f) => f.endsWith(CSS_EXTENSION))
      .map((f) => f.slice(folder.length + 1))
      .sort();
  } catch {
    return [];
  }
}

export async function snippetExists(app: App, fileName: string): Promise<boolean> {
  return await app.vault.adapter.exists(snippetVaultPath(app, fileName));
}

export async function readSnippetFile(app: App, fileName: string): Promise<{ content: string; mtime: number; size: number }> {
  const vaultPath = snippetVaultPath(app, fileName);
  if (!(await app.vault.adapter.exists(vaultPath))) {
    throw new SnippetError(`File not found: ${SNIPPETS_URI_PREFIX + fileName}`, 'SNIPPET_NOT_FOUND');
  }
  const content = await app.vault.adapter.read(vaultPath);
  // stat is null only for a vanished file; the content fallbacks keep the
  // response shape complete.
  const stat = await app.vault.adapter.stat(vaultPath);
  return { content, mtime: stat?.mtime ?? Date.now(), size: stat?.size ?? content.length };
}

export async function writeSnippetFile(app: App, fileName: string, content: string): Promise<{ mtime: number; size: number }> {
  // mkdir is idempotent in the adapter contract only when the folder exists;
  // the catch covers that case, and a real failure surfaces on write below.
  try {
    await app.vault.adapter.mkdir(`${app.vault.configDir}/snippets`);
  } catch {
    // The folder already exists.
  }
  const vaultPath = snippetVaultPath(app, fileName);
  await app.vault.adapter.write(vaultPath, content);
  const stat = await app.vault.adapter.stat(vaultPath);
  return { mtime: stat?.mtime ?? Date.now(), size: stat?.size ?? content.length };
}

/** Remove a snippet file permanently. No trash exists in config space. */
export async function removeSnippetFile(app: App, fileName: string): Promise<void> {
  const vaultPath = snippetVaultPath(app, fileName);
  if (!(await app.vault.adapter.exists(vaultPath))) {
    throw new SnippetError(`File not found: ${SNIPPETS_URI_PREFIX + fileName}`, 'SNIPPET_NOT_FOUND');
  }
  await app.vault.adapter.remove(vaultPath);
}
