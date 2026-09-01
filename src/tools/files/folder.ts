/**
 * files folder listing. The view tool reaches this handler through
 * view.folder: the read-side cases share the files handlers, and the view
 * definition delegates here.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, readPageArgs } from '../shared';
import { contentPage, jsonSize } from '../../utils/content-page';
import { RESOURCES_URI_PREFIX } from '../../resources/registry';
import { ResourceError } from '../../resources/types';
import { isSnippetsUri, isSnippetsFolderUri, SNIPPETS_URI_PREFIX } from '../../utils/css-snippets';
import { CONFIG_URI_PREFIX, CONFIG_KEYS, LOCALSTORAGE_KEYS } from '../../utils/app-config';
import { FOLDER_FETCH_ALL } from './helpers';

export async function handleFolder(ctx: RouterContext, params: Params): Promise<unknown> {
  // `path` names the folder to list. "/" means the vault root.
  const dirParam = paramStr(params, 'path');
  const directory = dirParam === '/' ? undefined : dirParam;

  // The resources namespace lists through the registry, as a tree: a
  // resource file at this level, or a folder for any deeper name
  // segment (infos/ holds the info resources). The listing is small and
  // complete, so pattern and page parameters do not apply. The bare
  // root (no trailing slash) lists the same content.
  const resourcesBareRoot = RESOURCES_URI_PREFIX.slice(0, -1);
  if (directory !== undefined && (directory.startsWith(RESOURCES_URI_PREFIX) || directory === resourcesBareRoot)) {
    if (!ctx.resources) {
      throw new Error(`Resource access is not wired on this router: ${directory}`);
    }
    const subPath = (directory.startsWith(RESOURCES_URI_PREFIX) ? directory.slice(RESOURCES_URI_PREFIX.length) : '')
      .replace(/\/+$/, '');
    const children = new Map<string, boolean>();
    for (const entry of ctx.resources.list()) {
      const rel = entry.uri.slice(RESOURCES_URI_PREFIX.length);
      if (subPath !== '' && !rel.startsWith(subPath + '/')) continue;
      const rest = subPath === '' ? rel : rel.slice(subPath.length + 1);
      const segment = rest.split('/')[0];
      if (segment !== '') {
        children.set(segment, rest.includes('/'));
      }
    }
    if (children.size === 0) {
      throw new ResourceError(`Unknown resource: ${directory}`);
    }
    const base = RESOURCES_URI_PREFIX + (subPath === '' ? '' : subPath + '/');
    const entries = [...children.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([segment, isFolder]) => ({ path: base + segment, name: segment, isFolder }));
    const folderCount = entries.filter((entry) => entry.isFolder).length;
    return {
      directory: base
      , files: entries
      , totalFiles: entries.length - folderCount
      , totalFolders: folderCount
    };
  }
  // The snippets namespace lists through the adapter, via listFiles so the
  // security layer applies: a folder-scoped session cannot enumerate it.
  // The entries are the URIs the read and edit actions accept. The listing
  // is small, so pattern and page parameters do not apply.
  if (directory !== undefined && isSnippetsUri(directory)) {
    if (!isSnippetsFolderUri(directory)) {
      throw new Error(`Directory not found: ${directory}`);
    }
    const names = await ctx.api.listFiles(SNIPPETS_URI_PREFIX);
    return {
      directory: SNIPPETS_URI_PREFIX
      , files: names.map((path) => {
        const name = path.slice(SNIPPETS_URI_PREFIX.length);
        return { path, name, isFolder: false };
      })
      , totalFiles: names.length
    };
  }

  // The config namespace lists the curated key catalog. The catalog is
  // plugin documentation, not app state: it holds no vault or config data,
  // so unlike the snippets listing it needs no security pass. The values
  // behind each key stay behind getFile.
  const configBareRoot = CONFIG_URI_PREFIX.slice(0, -1);
  if (directory !== undefined && (directory.startsWith(CONFIG_URI_PREFIX) || directory === configBareRoot)) {
    if (directory !== CONFIG_URI_PREFIX && directory !== configBareRoot) {
      throw new Error(`Directory not found: ${directory}`);
    }
    return {
      directory: CONFIG_URI_PREFIX
      , files: [
        ...Object.entries(CONFIG_KEYS)
        , ...Object.entries(LOCALSTORAGE_KEYS)
      ].map(([key]) => ({ path: CONFIG_URI_PREFIX + key, name: key, isFolder: false }))
      , totalFiles: Object.keys(CONFIG_KEYS).length + Object.keys(LOCALSTORAGE_KEYS).length
    };
  }

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
  // Presence matters, not truthiness: a zero page, pageSize, or limit
  // is invalid input for readPageArgs, not an absent parameter.
  if (pattern !== undefined || params.page !== undefined || params.pageSize !== undefined || params.limit !== undefined) {
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
