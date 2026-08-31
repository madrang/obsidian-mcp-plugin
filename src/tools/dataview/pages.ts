/**
 * dataview page listing and per-page metadata. Each result carries the
 * custom frontmatter fields.
 */
import { PluginDetector } from '../../utils/plugin-detector';
import { DataviewArray, DataviewPage } from './types';
import { toIsoOptional, asDataviewAPI, extractCustomFields } from './values';

/**
 * List all pages with metadata
 */
export function listPages(detector: PluginDetector, source?: string): unknown {
  if (!detector.isDataviewAPIReady()) {
    throw new Error('Dataview plugin is not available or not enabled');
  }

  const dataviewAPI = asDataviewAPI(detector.getDataviewAPI());

  try {
    // Get pages from source (folder, tag, etc.) or all pages
    const pages: DataviewArray<DataviewPage> = source
      ? dataviewAPI.pages(source)
      : dataviewAPI.pages();

    return {
      success: true
      , source: source || 'all'
      , count: pages.length
      , pages: pages.array().slice(0, 50).map((page: DataviewPage) => ({
        path: page.file.path
        , name: page.file.name
        , size: page.file.size
        , created: toIsoOptional(page.file.ctime)
        , modified: toIsoOptional(page.file.mtime)
        , tags: page.file.tags?.array() ?? []
        , links: page.file.outlinks?.array()?.length ?? 0
        , aliases: page.aliases?.array() ?? []
        // Include custom frontmatter fields
        , ...extractCustomFields(page)
      }))
    };
  } catch (error) {
    return {
      success: false
      , source: source || 'all'
      , error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get metadata for a specific page
 */
export function getPageMetadata(detector: PluginDetector, path: string): unknown {
  if (!detector.isDataviewAPIReady()) {
    throw new Error('Dataview plugin is not available or not enabled');
  }

  const dataviewAPI = asDataviewAPI(detector.getDataviewAPI());

  try {
    const page: DataviewPage | null = dataviewAPI.page(path);

    if (!page) {
      throw new Error(`Page not found: ${path}`);
    }

    return {
      success: true
      , path
      , metadata: {
        file: {
          path: page.file.path
          , name: page.file.name
          , basename: page.file.basename
          , extension: page.file.extension
          , size: page.file.size
          , created: toIsoOptional(page.file.ctime)
          , modified: toIsoOptional(page.file.mtime)
        }
        , tags: page.file.tags?.array() ?? []
        , aliases: page.aliases?.array() ?? []
        , outlinks: page.file.outlinks?.array() ?? []
        , inlinks: page.file.inlinks?.array() ?? []
        , tasks: page.file.tasks?.array()?.length ?? 0
        , lists: page.file.lists?.array()?.length ?? 0
        // Include all custom frontmatter fields
        , custom: extractCustomFields(page)
      }
    };
  } catch (error) {
    return {
      success: false
      , path
      , error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
