// Sorting the article list by column and filtering it by the status of each language.
//   npx tsx tests/seo/post-list.test.ts
import {
  DEFAULT_SORT,
  getLocaleFilter,
  getNextSort,
  getSort,
  getSortQuery,
  isLocaleMatch,
  sortArticles,
  type SortFields,
} from "../../src/app/admin/(dashboard)/post-list";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};

check("no parameters: newest change first", JSON.stringify(getSort(undefined, undefined)) === JSON.stringify(DEFAULT_SORT));
check("an unknown column falls back to the default", getSort("author", "asc").key === "updated");
check("a column without a direction starts with its own (titles A→Z)", getSort("title", undefined).dir === "asc");
check("clicking the current column reverses it", getNextSort({ key: "vi", dir: "asc" }, "vi").dir === "desc");
check("clicking another column starts with that column's direction", getNextSort({ key: "vi", dir: "desc" }, "updated").dir === "desc");
check("the default order has no parameters", getSortQuery(DEFAULT_SORT).sort === undefined && getSortQuery(DEFAULT_SORT).dir === undefined);
check("another order has both", JSON.stringify(getSortQuery({ key: "en", dir: "desc" })) === JSON.stringify({ sort: "en", dir: "desc" }));

check("an unknown filter value is ignored", getLocaleFilter("deleted") === undefined && getLocaleFilter("draft") === "draft");
const both = [{ locale: "vi" as const, status: "published" as const }, { locale: "en" as const, status: "draft" as const }];
const viOnly = [{ locale: "vi" as const, status: "published" as const }];
check("no filter keeps everything", isLocaleMatch(viOnly, "en", undefined));
check("EN draft matches an article whose English is a draft", isLocaleMatch(both, "en", "draft") && !isLocaleMatch(viOnly, "en", "draft"));
check("'not written' matches an article without that language", isLocaleMatch(viOnly, "en", "none") && !isLocaleMatch(both, "en", "none"));

const day = (d: number) => new Date(Date.UTC(2026, 9, d));
const articles: (SortFields & { id: string })[] = [
  { id: "a", title: "Báo cáo doanh thu", versions: [{ locale: "vi", status: "published" }], at: day(5) },
  { id: "b", title: "an toàn dữ liệu", versions: [{ locale: "vi", status: "draft" }, { locale: "en", status: "draft" }], at: day(7) },
  { id: "c", title: "Chỉ số spa", versions: [{ locale: "vi", status: "scheduled" }, { locale: "en", status: "published" }], at: day(6) },
  { id: "d", title: "Ảnh bìa", versions: [{ locale: "vi", status: "in_review" }], at: day(4) },
];
const ids = (sorted: { id: string }[]) => sorted.map((a) => a.id).join("");
const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
const sortedBy = (key: "title" | "vi" | "en" | "updated", dir: "asc" | "desc") => ids(sortArticles(articles, { key, dir }, (a) => a, collator));

check("newest change first by default", sortedBy("updated", "desc") === "bcad", sortedBy("updated", "desc"));
check("oldest first", sortedBy("updated", "asc") === "dacb", sortedBy("updated", "asc"));
// Vietnamese order ignores case and accents: a, Ả (a), B, C.
check("titles A→Z the Vietnamese way", sortedBy("title", "asc") === "bdac", sortedBy("title", "asc"));
check("VI in workflow order: draft, in review, scheduled, published", sortedBy("vi", "asc") === "bdca", sortedBy("vi", "asc"));
check("VI reversed", sortedBy("vi", "desc") === "acdb", sortedBy("vi", "desc"));
// Same EN status (not written): the most recently changed comes first.
check("EN: missing versions last, ties newest first", sortedBy("en", "asc") === "bcad", sortedBy("en", "asc"));
check("sorting returns a copy", ids(articles) === "abcd");
const untitled = [...articles, { id: "e", title: "", versions: [], at: day(8) }];
check("untitled articles come after the titled ones", ids(sortArticles(untitled, { key: "title", dir: "asc" }, (a) => a, collator)) === "bdace");

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
