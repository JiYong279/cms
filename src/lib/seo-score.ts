import { slugify } from "./posts";

/**
 * A 0–100 score of how ready an article version is for search, as a list of checks with advice.
 * It guides writers; it never blocks publishing. Keyword density is deliberately not scored:
 * chasing it produces worse articles.
 */

export type ScoreGroup = "seo" | "content" | "trust";

export type CheckId =
  | "seoTitleLength"
  | "metaDescriptionLength"
  | "keywordSet"
  | "keywordInTitle"
  | "keywordInDescription"
  | "keywordInSlug"
  | "keywordInIntro"
  | "keywordInHeading"
  | "slugLength"
  | "wordCount"
  | "sections"
  | "shortParagraphs"
  | "excerpt"
  | "category"
  | "internalLinks"
  | "cover"
  | "imagesAlt"
  | "author"
  | "translation";

export type ScoreCheck = {
  id: CheckId;
  group: ScoreGroup;
  weight: number;
  /** 0 (missing) to 1 (met); a few checks give half credit on the way there. */
  earned: number;
  /** Values for the check's message, e.g. the current length. */
  vars: Record<string, string | number>;
};

export type ScoreResult = { score: number; level: "good" | "ok" | "weak"; checks: ScoreCheck[] };

export type ScoreInput = {
  title: string;
  metaTitle: string;
  excerpt: string;
  metaDescription: string;
  focusKeyword: string;
  slug: string;
  html: string;
  categoryId: string | null;
  coverImageUrl: string | null;
  /** The author filled in a public profile for this language. */
  authorHasProfile: boolean;
  /** The other language's version exists and neither version is out of date. */
  translationInSync: boolean;
  /** Host of the website, to tell its own links from others (e.g. "www.qub-x.com"). */
  siteHost: string;
};

const WEIGHTS: Record<CheckId, [ScoreGroup, number]> = {
  seoTitleLength: ["seo", 8],
  metaDescriptionLength: ["seo", 8],
  keywordSet: ["seo", 5],
  keywordInTitle: ["seo", 6],
  keywordInDescription: ["seo", 4],
  keywordInSlug: ["seo", 4],
  keywordInIntro: ["seo", 5],
  keywordInHeading: ["seo", 4],
  slugLength: ["seo", 3],
  wordCount: ["content", 10],
  sections: ["content", 6],
  shortParagraphs: ["content", 4],
  excerpt: ["content", 4],
  category: ["content", 3],
  internalLinks: ["trust", 8],
  cover: ["trust", 5],
  imagesAlt: ["trust", 3],
  author: ["trust", 5],
  translation: ["trust", 5],
};

export const SCORE_THRESHOLDS = { good: 80, ok: 50 } as const;
export const MIN_WORDS = 1000;
export const MIN_SECTIONS = 3;
export const MAX_PARAGRAPH_WORDS = 150;
export const MIN_INTERNAL_LINKS = 2;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();
const words = (s: string) => (s ? s.split(" ").filter(Boolean).length : 0);
const norm = (s: string) => s.normalize("NFC").toLowerCase();

export function scoreArticle(input: ScoreInput): ScoreResult {
  const seoTitle = (input.metaTitle || input.title).trim();
  const seoDescription = (input.metaDescription || input.excerpt).trim();
  const keyword = norm(input.focusKeyword.trim());
  const has = (s: string) => !!keyword && norm(s).includes(keyword);

  const paragraphs = [...input.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1])).filter(Boolean);
  const bodyWords = words(text(input.html));
  const intro = paragraphs.join(" ").split(" ").slice(0, 100).join(" ");
  const headings = [...input.html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => text(m[1]));
  const sections = (input.html.match(/<h2\b/g) ?? []).length;
  const longParagraphs = paragraphs.filter((p) => words(p) > MAX_PARAGRAPH_WORDS).length;
  const images = input.html.match(/<img\b[^>]*>/g) ?? [];
  const missingAlt = images.filter((img) => !/\balt="[^"]+"/.test(img)).length;
  const host = input.siteHost.replace(/^www\./, "");
  const internalLinks = [...input.html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].filter(([, href]) => {
    if (href.startsWith("/") && !href.startsWith("//")) return true;
    try {
      return new URL(href).hostname.replace(/^www\./, "") === host;
    } catch {
      return false;
    }
  }).length;

  const met = (ok: boolean) => (ok ? 1 : 0);
  const results: Record<CheckId, [number, Record<string, string | number>]> = {
    seoTitleLength: [met(seoTitle.length >= 30 && seoTitle.length <= 60), { n: seoTitle.length }],
    metaDescriptionLength: [met(seoDescription.length >= 110 && seoDescription.length <= 160), { n: seoDescription.length }],
    keywordSet: [met(!!keyword), {}],
    keywordInTitle: [met(has(seoTitle)), {}],
    keywordInDescription: [met(has(seoDescription)), {}],
    keywordInSlug: [met(!!keyword && input.slug.includes(slugify(keyword))), {}],
    keywordInIntro: [met(has(intro)), {}],
    keywordInHeading: [met(headings.some(has)), {}],
    slugLength: [met(!!input.slug && input.slug.length <= 75), { n: input.slug.length }],
    // Half the points on the way there: a 700-word article is better than a 200-word one.
    wordCount: [bodyWords >= MIN_WORDS ? 1 : bodyWords >= MIN_WORDS * 0.6 ? 0.5 : 0, { n: bodyWords, min: MIN_WORDS }],
    sections: [sections >= MIN_SECTIONS ? 1 : sections > 0 ? 0.5 : 0, { n: sections, min: MIN_SECTIONS }],
    shortParagraphs: [met(paragraphs.length > 0 && longParagraphs === 0), { n: longParagraphs, max: MAX_PARAGRAPH_WORDS }],
    excerpt: [met(!!input.excerpt.trim()), {}],
    category: [met(!!input.categoryId), {}],
    internalLinks: [internalLinks >= MIN_INTERNAL_LINKS ? 1 : internalLinks > 0 ? 0.5 : 0, { n: internalLinks, min: MIN_INTERNAL_LINKS }],
    cover: [met(!!input.coverImageUrl?.trim()), {}],
    // An empty article has nothing to credit yet, images included.
    imagesAlt: [met(bodyWords > 0 && missingAlt === 0), { n: missingAlt }],
    author: [met(input.authorHasProfile), {}],
    translation: [met(input.translationInSync), {}],
  };

  const checks = (Object.keys(WEIGHTS) as CheckId[]).map((id) => ({
    id,
    group: WEIGHTS[id][0],
    weight: WEIGHTS[id][1],
    earned: results[id][0],
    vars: results[id][1],
  }));
  const score = Math.round(checks.reduce((sum, c) => sum + c.weight * c.earned, 0));
  return { score, level: scoreLevel(score), checks };
}

export function scoreLevel(score: number): ScoreResult["level"] {
  return score >= SCORE_THRESHOLDS.good ? "good" : score >= SCORE_THRESHOLDS.ok ? "ok" : "weak";
}
