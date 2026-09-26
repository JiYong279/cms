import type { Locale } from "@/db/schema";
import { siteBrief } from "./ai-brief";
import { slugify } from "./posts";
import { META_DESCRIPTION_LENGTH, SEO_TITLE_LENGTH, type CheckId } from "./seo-score";

/**
 * "Fix with AI" for the SEO score: which fields a failing check is fixed by, the prompt asking an
 * AI to rewrite them, and reading its answer back. The slug is never written by the AI: it is
 * derived from the search phrase.
 */

/** Fields an AI rewrites. */
export const AI_FIELDS = ["metaTitle", "metaDescription", "excerpt", "focusKeyword"] as const;
export type AiField = (typeof AI_FIELDS)[number];
/** Everything "Fix with AI" can change. */
export type FixField = AiField | "slug";

export const EXCERPT_MAX = 200;

/** The fields that fix each failing check (checks not listed need a person: cover, author, content…). */
export const FIX_FOR: Partial<Record<CheckId, FixField[]>> = {
  seoTitleLength: ["metaTitle"],
  keywordInTitle: ["metaTitle"],
  metaDescriptionLength: ["metaDescription"],
  keywordInDescription: ["metaDescription"],
  keywordSet: ["focusKeyword"],
  excerpt: ["excerpt"],
  keywordInSlug: ["slug"],
  slugLength: ["slug"],
};

/** The fields fixing these checks, in a stable order. */
export function fieldsFor(checks: CheckId[]): FixField[] {
  const wanted = new Set(checks.flatMap((c) => FIX_FOR[c] ?? []));
  return ([...AI_FIELDS, "slug"] as FixField[]).filter((f) => wanted.has(f));
}

export type FixArticle = {
  title: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  html: string;
};

/** Length rule of a field, for the prompt and for flagging an answer that ignored it. */
export const LIMITS: Record<AiField, { min?: number; max: number }> = {
  metaTitle: SEO_TITLE_LENGTH,
  metaDescription: META_DESCRIPTION_LENGTH,
  excerpt: { max: EXCERPT_MAX },
  focusKeyword: { max: 60 },
};

export function withinLimits(field: FixField, value: string) {
  if (field === "slug") return value.length > 0 && value.length <= 75;
  const { min, max } = LIMITS[field];
  const n = value.trim().length;
  return n > 0 && (min === undefined || n >= min) && n <= max;
}

/** The article's text without markup, cut to a length a prompt can carry. */
function plainText(html: string, max = 6000) {
  const text = html
    .replace(/<(h[23])\b[^>]*>/g, "\n## ")
    .replace(/<\/(p|h[23]|li)>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const RULES: Record<Locale, Record<AiField, string>> = {
  vi: {
    metaTitle: `metaTitle: tiêu đề hiện trên Google, ${SEO_TITLE_LENGTH.min}–${SEO_TITLE_LENGTH.max} ký tự, có từ khoá chính càng gần đầu càng tốt, hấp dẫn để người ta bấm vào.`,
    metaDescription: `metaDescription: đoạn mô tả dưới tiêu đề trên Google, ${META_DESCRIPTION_LENGTH.min}–${META_DESCRIPTION_LENGTH.max} ký tự, 1–2 câu có từ khoá chính, nói rõ người đọc được gì.`,
    excerpt: `excerpt: tóm tắt 1–2 câu hiện dưới tiêu đề bài, tối đa ${EXCERPT_MAX} ký tự.`,
    focusKeyword: "focusKeyword: cụm 2–5 từ mà khách hàng hay gõ trên Google để tìm đúng nội dung bài này.",
  },
  en: {
    metaTitle: `metaTitle: the title shown on Google, ${SEO_TITLE_LENGTH.min}–${SEO_TITLE_LENGTH.max} characters, with the search phrase as near the start as possible, worth clicking.`,
    metaDescription: `metaDescription: the snippet under the title on Google, ${META_DESCRIPTION_LENGTH.min}–${META_DESCRIPTION_LENGTH.max} characters, 1–2 sentences with the search phrase, saying what the reader gets.`,
    excerpt: `excerpt: a 1–2 sentence summary shown under the article title, at most ${EXCERPT_MAX} characters.`,
    focusKeyword: "focusKeyword: the 2–5 word phrase customers type into Google to find what this article covers.",
  },
};

/** The last line of every prompt: only a prompt carries it, so a pasted-back prompt is recognised. */
const ANSWER_RULE: Record<Locale, string> = {
  vi: "Chỉ trả về MỘT khối code ```markdown chứa các dòng trên giữa hai dòng ---, không giải thích gì thêm.",
  en: "Answer with ONE ```markdown code block holding the lines above between two --- lines, and nothing else.",
};

/**
 * The prompt asking an assistant to rewrite `fields` of the article, in the article's language.
 * `answer`: "paste" for a chat the person copies it into, "tool" when the API answers through a tool.
 */
export function seoFixPrompt(input: {
  site: { id: string; name: string; baseUrl: string };
  locale: Locale;
  fields: AiField[];
  article: FixArticle;
  answer: "paste" | "tool";
}) {
  const vi = input.locale === "vi";
  const a = input.article;
  const keyword = a.focusKeyword.trim();
  const lines = vi
    ? [
        `Bạn là biên tập viên SEO cho website ${input.site.name} (${input.site.baseUrl}).`,
        `Bối cảnh: ${siteBrief(input.site.id, input.site)}`,
        "",
        `Viết lại các phần SEO sau của bài bên dưới, bằng tiếng Việt, đúng giọng văn của bài:`,
        ...input.fields.map((f) => `- ${RULES.vi[f]}`),
        keyword && !input.fields.includes("focusKeyword") ? `Từ khoá chính của bài: "${keyword}" (giữ nguyên).` : null,
        "Không bịa thông tin không có trong bài.",
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.vi : null,
      ]
    : [
        `You are the SEO editor of ${input.site.name} (${input.site.baseUrl}).`,
        `Context: ${siteBrief(input.site.id, input.site)}`,
        "",
        "Rewrite these SEO fields of the article below, in English, in the article's own voice:",
        ...input.fields.map((f) => `- ${RULES.en[f]}`),
        keyword && !input.fields.includes("focusKeyword") ? `The article's search phrase: "${keyword}" (keep it).` : null,
        "Do not state anything the article does not say.",
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.en : null,
      ];
  const article = [
    "",
    "=====",
    `Title: ${a.title}`,
    `Summary: ${a.excerpt}`,
    `SEO title: ${a.metaTitle}`,
    `SEO description: ${a.metaDescription}`,
    `Search phrase: ${a.focusKeyword}`,
    "",
    plainText(a.html),
  ];
  // Omitted lines are null; empty strings are deliberate blank lines.
  return [...lines.filter((l) => l !== null), ...article].join("\n");
}

export type FixPasteError = "empty" | "isPrompt" | "nothing";

/** Reads the fields back from an assistant's answer; lines for fields not asked for are ignored. */
export function parseSeoFix(text: string, fields: AiField[]): { ok: true; values: Partial<Record<AiField, string>> } | { ok: false; error: FixPasteError } {
  const src = text.replace(/\r\n?/g, "\n").trim();
  if (!src) return { ok: false, error: "empty" };
  if (src.includes(ANSWER_RULE.vi) || src.includes(ANSWER_RULE.en)) return { ok: false, error: "isPrompt" };
  const values: Partial<Record<AiField, string>> = {};
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*[-*]?\s*\**([A-Za-z]+)\**\s*:\s*(.+?)\s*$/);
    const field = m && AI_FIELDS.find((f) => f.toLowerCase() === m[1].toLowerCase());
    if (field && fields.includes(field) && !(field in values)) values[field] = m[2].replace(/^["'“]|["'”]$/g, "").trim();
  }
  return Object.keys(values).length ? { ok: true, values } : { ok: false, error: "nothing" };
}

/** The address suggested for a search phrase. */
export function suggestSlug(keyword: string) {
  return slugify(keyword).slice(0, 75).replace(/-+$/, "");
}
