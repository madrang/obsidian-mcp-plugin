/**
 * Shared helpers for the files action modules.
 */

/** Fetch cap for the folder universe before the content-budget window cuts it. */
export const FOLDER_FETCH_ALL = 1000000;
/** Fetch cap for search results before the content-budget window cuts them. */
export const SEARCH_FETCH_CAP = 5000;

export type FragmentStrategy = 'auto' | 'adaptive' | 'proximity' | 'structure';

/**
 * Resolve the caller-facing fragment strategy onto the internal one.
 *
 * 'structure' cuts on the document's own headings and paragraphs. It never does
 * embedding or vector similarity, which the index does not implement.
 */
export function resolveFragmentStrategy(strategy: string | undefined): FragmentStrategy {
  if (strategy === 'structure') return 'structure';
  if (strategy === 'adaptive' || strategy === 'proximity') return strategy;
  return 'auto';
}
