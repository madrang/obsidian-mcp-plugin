/**
 * Content-budget pagination for the list actions (folder, search, fragments).
 *
 * `pageSize` is the page content text size in characters, with one default
 * for every action: items accumulate into a page until the next one would
 * overflow the budget. `limit` caps the item count. A page can return fewer
 * items than asked when the budget or the result count cuts first. A single
 * item larger than the budget still lands on its own page, so a page is
 * never empty while items remain.
 */

/** One default page content size for every list action, in characters. */
export const CONTENT_PAGE_DEFAULT_SIZE = 50000;

/**
 * Fixed fetch cap for a fragment universe. The cap must not depend on the
 * requested page: a universe that grows while the caller walks makes the
 * reported totals shift under them. Retrieval is in-memory, so a fixed cap
 * costs nothing per page.
 */
export const FRAGMENT_FETCH_CAP = 500;

export interface ContentPageArgs {
  page?: number;
  pageSize?: number;
  limit?: number;
}

export interface ContentPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  limit?: number;
  totalItems: number;
  totalPages: number;
  /** 1-based index of the first item on this page (0 when the page is empty). */
  pageStart: number;
  /** 1-based index of the last item on this page (0 when the page is empty). */
  pageEnd: number;
  hasMore: boolean;
}

/** Serialized size of one item, the shared measure of page content text. */
export function jsonSize(item: unknown): number {
  return JSON.stringify(item)?.length ?? 0;
}

export function contentPage<T>(caller: string, all: T[], args: ContentPageArgs, sizeOf: (item: T) => number): ContentPage<T> {
  const page = args.page ?? 1;
  const budget = args.pageSize ?? CONTENT_PAGE_DEFAULT_SIZE;
  const limit = args.limit;

  const capped = limit !== undefined ? all.slice(0, limit) : all;
  const totalItems = capped.length;

  let idx = 0;
  let totalPages = 0;
  let pageStart = 0;
  let pageEnd = 0;

  while (idx < totalItems) {
    const windowStart = idx;
    let used = 0;
    while (idx < totalItems && (used === 0 || used + sizeOf(capped[idx]) <= budget)) {
      used += sizeOf(capped[idx]);
      idx++;
    }
    totalPages++;
    if (totalPages === page) {
      // 1-based item indices for the "showing X-Y" display.
      pageStart = windowStart + 1;
      pageEnd = idx;
    }
  }

  const onPage = page <= totalPages && totalPages > 0;
  return {
    items: onPage ? capped.slice(pageStart - 1, pageEnd) : []
    , page
    , pageSize: budget
    , ...(limit !== undefined ? { limit } : {})
    , totalItems
    , totalPages
    , pageStart: onPage ? pageStart : 0
    , pageEnd: onPage ? pageEnd : 0
    , hasMore: page < totalPages,
  };
}
