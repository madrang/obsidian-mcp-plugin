/**
 * Path and tag filter builders shared by the graph operations. A note
 * passes when every filter passes.
 */
import { getAllTags, CachedMetadata } from 'obsidian';

/**
 * Path filters shared by the graph operations. Each entry tests one
 * vault-relative path. A note passes when every filter passes. Exported for
 * tests.
 */
export function buildPathFilters(params: { fileFilter?: string; folderFilter?: string }): Array<(path: string) => boolean> {
  const filters: Array<(path: string) => boolean> = [];
  if (params.fileFilter) {
    const regex = new RegExp(params.fileFilter);
    filters.push(path => regex.test(path));
  }
  if (params.folderFilter) {
    const folder = params.folderFilter;
    // The separator guard stops "Projects" from matching a sibling folder
    // with a shared prefix.
    filters.push(path => path === folder || path.startsWith(folder + '/'));
  }
  return filters;
}

/**
 * Tag filter shared by the graph operations. A note passes when it carries
 * every listed tag. The leading # is optional and matching ignores case.
 * Returns undefined when no tag filter is given. Exported for tests.
 */
export function buildTagPredicate(tagFilter?: string[]): ((tags: string[] | undefined) => boolean) | undefined {
  if (!tagFilter || tagFilter.length === 0) return undefined;
  const normalize = (tag: string) => tag.replace(/^#/, '').toLowerCase();
  const wanted = tagFilter.map(normalize);
  return tags => {
    const have = new Set((tags ?? []).map(normalize));
    return wanted.every(tag => have.has(tag));
  };
}

/**
 * Node tags from BOTH sources: getAllTags merges inline #tags and
 * frontmatter tags. Reading cache.tags alone sees inline only, so a vault
 * that keeps its tags in frontmatter fails every tag filter.
 */
export function nodeTags(cache?: CachedMetadata | null): string[] {
  return cache ? getAllTags(cache) ?? [] : [];
}
