import type { Locale } from "@/db/schema";
import { siteBrief, type BriefSite } from "./ai-brief";

/**
 * Categories are the blog's topics: the content overview measures coverage per category. The AI
 * helps in two ways, always as a proposal the team reviews:
 * - suggesting the set of categories (new topics, better names), from the brief and the articles;
 * - placing articles that have no category into one.
 * It never deletes or merges categories: that stays a person's decision on the categories page.
 */

export const MAX_CATEGORY_IDEAS = 10;
/** Articles sent in one placement request. */
export const MAX_PLACED_ARTICLES = 60;
/** Article titles given as examples of what the website writes about. */
const MAX_SAMPLE_TITLES = 150;

export type CategoryIdea = {
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  /** Names of existing categories this topic continues (one), merges (several) or none: a new topic. */
  from: string[];
  why: string;
};

export type ExistingCategory = { id: string; nameVi: string; nameEn: string; posts: number };

type Language = Locale;

/** The last line of each paste-back prompt: only a prompt carries it, so a pasted-back prompt is recognised. */
const ANSWER_RULE = {
  categories: {
    vi: "Chỉ trả về MỘT khối code ```markdown gồm các khối danh mục theo đúng mẫu trên, không giải thích gì thêm.",
    en: "Answer with ONE ```markdown code block holding the category blocks in exactly the format above, and nothing else.",
  },
  placements: {
    vi: "Chỉ trả về MỘT khối code ```text, mỗi dòng “số bài: tên danh mục”, không giải thích gì thêm.",
    en: "Answer with ONE ```text code block, one “article number: category name” line each, and nothing else.",
  },
} satisfies Record<string, Record<Language, string>>;

export type CategoryPasteError = "empty" | "isPrompt" | "nothing";

export function categoryPlanPrompt(input: {
  site: BriefSite;
  /** The language the team reads the reasons in. */
  lang: Language;
  existing: ExistingCategory[];
  titles: { title: string; category: string | null }[];
  answer: "paste" | "tool";
}) {
  const vi = input.lang === "vi";
  const existing = input.existing.map((c) => `- ${c.nameVi} / ${c.nameEn} (${c.posts} ${vi ? "bài" : "articles"})`);
  const titles = input.titles
    .filter((a) => a.title.trim())
    .slice(0, MAX_SAMPLE_TITLES)
    .map((a) => `- ${a.title}${a.category ? ` [${a.category}]` : ""}`);
  const format = ["### 1", "vi: …", "en: …", "about_vi: …", "about_en: …", "from: …", "why: …"];
  const lines = vi
    ? [
        `Bạn là trưởng nhóm nội dung SEO cho website ${input.site.name} (${input.site.baseUrl}).`,
        `Bối cảnh: ${siteBrief(input.site)}`,
        "",
        "Đề xuất bộ danh mục cho blog: mỗi danh mục là một chủ đề chính mà người đọc tìm trên Google, đủ rộng để viết 1 bài trụ cột và 8–15 bài nhỏ hơn.",
        `- Từ 3 đến ${MAX_CATEGORY_IDEAS} danh mục, không trùng ý nhau. Tên ngắn (2–5 từ), có tên tiếng Việt và tiếng Anh.`,
        "- about_vi / about_en: một câu giới thiệu danh mục, hiện ở đầu trang danh mục trên website.",
        "- from: tên (tiếng Việt) của danh mục đang có mà chủ đề này tiếp nối; nhiều danh mục nên gộp thì cách nhau bởi |; để trống nếu là chủ đề mới.",
        "- Giữ nguyên danh mục đang có nếu nó vẫn hợp lý; chỉ đổi tên khi tên mới rõ hơn hẳn cho người đọc.",
        "- why: một câu nói vì sao nên có (hoặc đổi) danh mục này.",
        existing.length ? `\nDanh mục đang có:\n${existing.join("\n")}` : "\nWebsite chưa có danh mục nào.",
        titles.length ? `\nCác bài đang có [danh mục hiện tại]:\n${titles.join("\n")}` : null,
        "",
        input.answer === "paste" ? `Mỗi danh mục một khối theo mẫu:\n${format.join("\n")}` : null,
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.categories.vi : null,
      ]
    : [
        `You lead SEO content for ${input.site.name} (${input.site.baseUrl}).`,
        `Context: ${siteBrief(input.site)}`,
        "",
        "Propose the blog's categories: each is a main topic readers search Google for, broad enough for 1 pillar article and 8–15 smaller ones.",
        `- 3 to ${MAX_CATEGORY_IDEAS} categories, none overlapping. Short names (2–5 words), in Vietnamese and in English.`,
        "- about_vi / about_en: one sentence introducing the category, shown at the top of its page on the website.",
        "- from: the (Vietnamese) name of the existing category this topic continues; several to merge, separated by |; empty for a new topic.",
        "- Keep an existing category when it still makes sense; rename only when the new name is clearly better for readers.",
        "- why: one sentence on why the category should exist (or change).",
        existing.length ? `\nExisting categories:\n${existing.join("\n")}` : "\nThe website has no categories yet.",
        titles.length ? `\nArticles so far [current category]:\n${titles.join("\n")}` : null,
        "",
        input.answer === "paste" ? `One block per category, in this format:\n${format.join("\n")}` : null,
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.categories.en : null,
      ];
  return lines.filter((l) => l !== null).join("\n").trim();
}

const IDEA_KEYS: Record<string, keyof CategoryIdea> = {
  vi: "nameVi",
  en: "nameEn",
  about_vi: "descriptionVi",
  about_en: "descriptionEn",
  from: "from",
  why: "why",
};

/** Reads the category blocks of an assistant's answer; a block needs both names. */
export function parseCategoryPlan(text: string): { ok: true; ideas: CategoryIdea[] } | { ok: false; error: CategoryPasteError } {
  const src = text.replace(/\r\n?/g, "\n").trim();
  if (!src) return { ok: false, error: "empty" };
  if (src.includes(ANSWER_RULE.categories.vi) || src.includes(ANSWER_RULE.categories.en)) return { ok: false, error: "isPrompt" };
  const ideas: CategoryIdea[] = [];
  let current: CategoryIdea | null = null;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (/^#{2,}\s*\d*/.test(line)) {
      current = { nameVi: "", nameEn: "", descriptionVi: "", descriptionEn: "", from: [], why: "" };
      ideas.push(current);
      continue;
    }
    const field = line.match(/^[-*]?\s*\**([A-Za-z_]+)\**\s*:\s*(.*)$/);
    const key = field && IDEA_KEYS[field[1].toLowerCase()];
    if (!key) continue;
    if (!current) {
      current = { nameVi: "", nameEn: "", descriptionVi: "", descriptionEn: "", from: [], why: "" };
      ideas.push(current);
    }
    const value = field[2].trim().replace(/^["'“]|["'”]$/g, "");
    if (key === "from") current.from = value.split("|").map((s) => s.trim()).filter((s) => s && s !== "-" && !/^(none|không|trống)$/i.test(s));
    else current[key] = value;
  }
  const kept = ideas.filter((i) => i.nameVi && i.nameEn).slice(0, MAX_CATEGORY_IDEAS);
  return kept.length ? { ok: true, ideas: kept } : { ok: false, error: "nothing" };
}

const same = (a: string, b: string) => a.normalize("NFC").trim().toLowerCase() === b.normalize("NFC").trim().toLowerCase();

export type IdeaKind = "new" | "keep" | "rename" | "merge";

export type ReviewedIdea = CategoryIdea & {
  kind: IdeaKind;
  /** keep / rename: the category it applies to; merge: the categories it would bring together. */
  existing: ExistingCategory[];
};

/**
 * What each idea would change: a new category, a kept or renamed one, or categories to merge (advice
 * only). Existing categories no idea continues are returned apart, also as advice.
 */
export function reviewCategoryPlan(ideas: CategoryIdea[], existing: ExistingCategory[]): { ideas: ReviewedIdea[]; unused: ExistingCategory[] } {
  const reviewed = ideas.map((idea): ReviewedIdea => {
    // An idea named like an existing category continues it, even when "from" was left out.
    const named = existing.filter((c) => same(c.nameVi, idea.nameVi) || same(c.nameEn, idea.nameEn));
    const from = existing.filter((c) => idea.from.some((f) => same(f, c.nameVi) || same(f, c.nameEn)));
    const matched = [...new Set([...from, ...named])];
    if (matched.length === 0) return { ...idea, kind: "new", existing: [] };
    if (matched.length > 1) return { ...idea, kind: "merge", existing: matched };
    const [c] = matched;
    return { ...idea, kind: same(c.nameVi, idea.nameVi) && same(c.nameEn, idea.nameEn) ? "keep" : "rename", existing: matched };
  });
  const used = new Set(reviewed.flatMap((i) => i.existing.map((c) => c.id)));
  return { ideas: reviewed, unused: existing.filter((c) => !used.has(c.id)) };
}

export type PlaceArticle = { n: number; title: string; excerpt: string };

export function placementPrompt(input: { site: BriefSite; lang: Language; categories: string[]; articles: PlaceArticle[]; answer: "paste" | "tool" }) {
  const vi = input.lang === "vi";
  const articles = input.articles.slice(0, MAX_PLACED_ARTICLES).map((a) => `${a.n}. ${a.title}${a.excerpt.trim() ? ` — ${a.excerpt.trim().slice(0, 200)}` : ""}`);
  const lines = vi
    ? [
        `Bạn biên tập blog của website ${input.site.name} (${input.site.baseUrl}).`,
        `Bối cảnh: ${siteBrief(input.site)}`,
        "",
        "Xếp mỗi bài dưới đây vào đúng MỘT danh mục đang có, danh mục mà người đọc sẽ tìm bài đó trong.",
        `Danh mục: ${input.categories.join(" | ")}`,
        "Bài nào không hợp danh mục nào thì ghi “-”.",
        "",
        "Các bài:",
        ...articles,
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.placements.vi : null,
      ]
    : [
        `You edit the blog of ${input.site.name} (${input.site.baseUrl}).`,
        `Context: ${siteBrief(input.site)}`,
        "",
        "Put each article below in exactly ONE of the existing categories, the one readers would look for it in.",
        `Categories: ${input.categories.join(" | ")}`,
        "Write “-” for an article that fits none of them.",
        "",
        "Articles:",
        ...articles,
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.placements.en : null,
      ];
  return lines.filter((l) => l !== null).join("\n").trim();
}

/** Reads "number: category" lines; unknown numbers and categories are left out. */
export function parsePlacements(
  text: string,
  articles: PlaceArticle[],
  categories: string[],
): { ok: true; placements: Map<number, string> } | { ok: false; error: CategoryPasteError } {
  const src = text.replace(/\r\n?/g, "\n").trim();
  if (!src) return { ok: false, error: "empty" };
  if (src.includes(ANSWER_RULE.placements.vi) || src.includes(ANSWER_RULE.placements.en)) return { ok: false, error: "isPrompt" };
  const numbers = new Set(articles.map((a) => a.n));
  const placements = new Map<number, string>();
  for (const raw of src.split("\n")) {
    const m = raw.trim().match(/^[-*]?\s*(?:bài|article|#)?\s*(\d+)\s*[:.)\-–—]\s*(.+)$/i);
    if (!m || !numbers.has(Number(m[1]))) continue;
    const name = m[2].trim().replace(/^\**|\**$/g, "").replace(/^["'“]|["'”]$/g, "");
    const category = categories.find((c) => same(c, name));
    if (category) placements.set(Number(m[1]), category);
  }
  return placements.size ? { ok: true, placements } : { ok: false, error: "nothing" };
}
