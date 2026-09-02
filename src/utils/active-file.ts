/**
 * The active-file read: serve the file open in the editor. Writes target
 * files by path; an agent reads the active file's path with view.active and
 * uses the path-based actions.
 */
import { App, TFile, getAllTags } from 'obsidian';
import { ObsidianFile } from '../types/obsidian';

/** The file open in the editor, or the vault-file error shape when none. */
function requireActiveFile(app: App): TFile {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    throw new Error('No active file');
  }
  return activeFile;
}

export async function getActiveFile(app: App): Promise<ObsidianFile> {
  const activeFile = requireActiveFile(app);

  const content = await app.vault.read(activeFile);

  // Extract metadata from cache
  const cache = app.metadataCache.getFileCache(activeFile);
  const tags = cache ? (getAllTags(cache) || []) : [];
  const frontmatter = cache?.frontmatter ? { ...cache.frontmatter } : {};

  // Remove position metadata from frontmatter (internal Obsidian data)
  if (frontmatter.position) {
    delete frontmatter.position;
  }

  return {
    path: activeFile.path
    , content
    , tags
    , frontmatter
  };
}
