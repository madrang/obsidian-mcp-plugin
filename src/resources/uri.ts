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
