import type { Locale, PostStatus } from "@/db/schema";

/**
 * Sorting and per-language status filters of the article list. Both live in the address
 * (?sort=vi&dir=asc&en=draft), so a filtered, sorted list can be bookmarked or shared.
 */

export const SORT_KEYS = ["title", "vi", "en", "updated"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type Sort = { key: SortKey; dir: SortDir };

/** What a column sorts by first when clicked: titles A→Z, statuses in workflow order, newest first. */
const FIRST_DIR: Record<SortKey, SortDir> = { title: "asc", vi: "asc", en: "asc", updated: "desc" };
export const DEFAULT_SORT: Sort = { key: "updated", dir: "desc" };

/** Workflow order; a language not written yet comes last. */
const STATUS_ORDER: Record<PostStatus, number> = { draft: 0, in_review: 1, scheduled: 2, published: 3, archived: 4 };
const MISSING = 5;

/** A language filter: one status, or "none" for articles without that language yet. */
export const LOCALE_FILTERS = ["none", "draft", "in_review", "scheduled", "published", "archived"] as const;
export type LocaleFilter = (typeof LOCALE_FILTERS)[number];

export function getSort(key: string | undefined, dir: string | undefined): Sort {
  const k = SORT_KEYS.find((s) => s === key);
  if (!k) return DEFAULT_SORT;
  return { key: k, dir: dir === "asc" || dir === "desc" ? dir : FIRST_DIR[k] };
}

/** The address parameters of a sort; the default order has none (both are cleared). */
export function getSortQuery(sort: Sort): { sort: string | undefined; dir: string | undefined } {
  const isDefault = sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir;
  return isDefault ? { sort: undefined, dir: undefined } : { sort: sort.key, dir: sort.dir };
}

/** Where a column header leads: the other direction when it is already the sort. */
export function getNextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

export function getLocaleFilter(value: string | undefined): LocaleFilter | undefined {
  return LOCALE_FILTERS.find((f) => f === value);
}

type Version = { locale: Locale; status: PostStatus };

/** Whether an article's version in `locale` matches the filter (no filter: every article). */
export function isLocaleMatch(versions: Version[], locale: Locale, filter: LocaleFilter | undefined) {
  if (!filter) return true;
  const status = versions.find((v) => v.locale === locale)?.status;
  return filter === "none" ? !status : status === filter;
}

/** What sorting needs from an article. */
export type SortFields = { title: string; versions: Version[]; at: Date };

/** A sorted copy. Ties keep the most recently changed first. */
export function sortArticles<T>(items: T[], sort: Sort, read: (item: T) => SortFields, collator: Intl.Collator): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const rank = (f: SortFields, locale: Locale) => {
    const status = f.versions.find((v) => v.locale === locale)?.status;
    return status ? STATUS_ORDER[status] : MISSING;
  };
  const by = (a: SortFields, b: SortFields) => {
    // Untitled articles come after the titled ones.
    if (sort.key === "title") return !a.title || !b.title ? Number(!a.title) - Number(!b.title) : collator.compare(a.title, b.title);
    if (sort.key === "vi" || sort.key === "en") return rank(a, sort.key) - rank(b, sort.key);
    return a.at.getTime() - b.at.getTime();
  };
  return items
    .map((item) => ({ item, f: read(item) }))
    .sort((x, y) => sign * by(x.f, y.f) || y.f.at.getTime() - x.f.at.getTime())
    .map((x) => x.item);
}
