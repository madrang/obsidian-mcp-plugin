/**
 * The obsidian://resources/ URI prefix and matcher. Leaf module with no
 * imports: the registry, the ObsidianAPI dispatch, and the security layer
 * all name the namespace through it, so none of them depends on the others.
 */

export const RESOURCES_URI_PREFIX = 'obsidian://resources/';

/** True when a path belongs to the obsidian://resources/ namespace. The
 * other managed namespaces (snippets, config) have their own prefixes and
 * fall through to their own handlers. */
export function isResourceUri(path?: string | null): boolean {
  return !!path && path.startsWith(RESOURCES_URI_PREFIX);
}

/**
 * Reduce a requested resource address to its candidate name for registry
 * matching. The canonical form comes first (obsidian://resources/<name>).
 * The tolerated shapes follow the ones agents send in practice when they
 * fabricate an address instead of copying one from resources/list: a bare
 * name (AGENTS.md, version-check), a file:// address (file:///AGENTS.md),
 * and a bare obsidian:// scheme (obsidian://AGENTS.md). The candidate only
 * ever matches a registered name, so a foreign address — another
 * obsidian:// namespace, a vault path, a traversal string — names no
 * resource and stays refused.
 */
export function resourceUriToName(requested: string): string {
  let candidate = requested;
  if (candidate.startsWith(RESOURCES_URI_PREFIX)) {
    candidate = candidate.slice(RESOURCES_URI_PREFIX.length);
    return candidate;
  }
  if (candidate.startsWith('file://')) {
    candidate = candidate.slice('file://'.length);
  } else if (candidate.startsWith('obsidian://')) {
    candidate = candidate.slice('obsidian://'.length);
  }
  while (candidate.startsWith('./') || candidate.startsWith('/')) {
    candidate = candidate.slice(candidate.startsWith('./') ? 2 : 1);
  }
  return candidate;
}
