import type { JSONContent } from "@tiptap/react";
import type { Locale } from "@/db/schema";
import { siteBrief, type BriefSite } from "./ai-brief";

/**
 * "Plan with AI" on the editorial calendar: an AI proposes a cluster of articles around a topic
 * (one overview, the rest each answering one question), the team keeps what it wants, and each
 * kept idea becomes a draft on its planned day, holding its outline and why it is worth writing.
 */

/** How often the planned articles come out. */
export const CADENCES = ["weekdays", "daily", "threePerWeek", "twoPerWeek", "weekly"] as const;
export type Cadence = (typeof CADENCES)[number];
export const MAX_PLAN_ARTICLES = 30;

export type PlanIdea = {
  title: string;
  focusKeyword: string;
  /** Name of an existing category, as the AI gave it (matched by the dialog). */
  category: string;
  /** The overview article of the cluster. */
  pillar: boolean;
  why: string;
  outline: string[];
};

const DAY_MS = 24 * 60 * 60_000;

/** Days (YYYY-MM-DD) for `count` articles from `start` on, following the cadence. */
export function planDates(start: string, count: number, cadence: Cadence): string[] {
  // Days of the week each cadence publishes on (0 = Sunday); weekly keeps the start's own day.
  const first = new Date(`${start}T00:00:00Z`);
  const days: Record<Cadence, number[]> = {
    weekdays: [1, 2, 3, 4, 5],
    daily: [0, 1, 2, 3, 4, 5, 6],
    threePerWeek: [1, 3, 5],
    twoPerWeek: [2, 4],
    weekly: [first.getUTCDay()],
  };
  const out: string[] = [];
  for (let t = first.getTime(); out.length < count; t += DAY_MS) {
    const day = new Date(t);
    if (days[cadence].includes(day.getUTCDay())) out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

/** The last line of the paste-back prompt: only a prompt carries it, so a pasted-back prompt is recognised. */
const ANSWER_RULE: Record<Locale, string> = {
  vi: "Chỉ trả về MỘT khối code ```markdown gồm các khối bài theo đúng mẫu trên, không giải thích gì thêm.",
  en: "Answer with ONE ```markdown code block holding the article blocks in exactly the format above, and nothing else.",
};

type PromptInput = {
  site: BriefSite;
  locale: Locale;
  topic: string;
  count: number;
  categories: string[];
  /** Titles already on the website, not to be repeated. */
  existing: string[];
  answer: "paste" | "tool";
};

/** The prompt asking an assistant for a cluster of `count` articles around `topic`, in the articles' language. */
export function contentPlanPrompt(input: PromptInput) {
  const vi = input.locale === "vi";
  const existing = input.existing.filter((t) => t.trim()).slice(0, 200);
  const format = [
    "### 1",
    "title: …",
    "keyword: …",
    input.categories.length ? "category: …" : null,
    "pillar: yes",
    "why: …",
    "outline: … | … | …",
  ].filter((l) => l !== null);
  const lines = vi
    ? [
        `Bạn là trưởng nhóm nội dung SEO cho website ${input.site.name} (${input.site.baseUrl}).`,
        `Bối cảnh: ${siteBrief(input.site)}`,
        "",
        `Lập kế hoạch một cụm ${input.count} bài blog bằng tiếng Việt quanh chủ đề: "${input.topic.trim()}".`,
        "- Bài 1 là bài tổng quan (pillar: yes) bao quát cả chủ đề. Các bài còn lại (pillar: no) mỗi bài trả lời MỘT câu hỏi cụ thể mà người đọc của website (xem bối cảnh) hay gõ trên Google: cách làm, so sánh, chi phí, checklist, quy định, lỗi hay gặp…",
        "- Không có hai bài trùng ý, và không trùng các bài website đã có.",
        "- title: viết theo cách người đọc hỏi hoặc gõ tìm, tối đa khoảng 70 ký tự. keyword: cụm 2–5 từ người ta thật sự gõ để tìm bài đó; mỗi bài một từ khoá riêng, không trùng với bài khác trong cụm hay bài website đã có.",
        "- Câu hỏi quá nhỏ để thành một bài thì đưa vào dàn ý của bài gần nhất (mục Câu hỏi thường gặp), không tách thành bài riêng.",
        input.categories.length ? `- category: đúng một trong: ${input.categories.join(" | ")}` : null,
        "- why: một câu nói ai tìm bài này và họ cần gì.",
        "- outline: 3–6 đề mục chính của bài, viết dạng câu hỏi người đọc hay hỏi khi hợp lý, cách nhau bởi dấu |.",
        existing.length ? `\nCác bài website đã có (không viết lại):\n${existing.map((t) => `- ${t}`).join("\n")}` : null,
        "",
        input.answer === "paste" ? `Mỗi bài một khối theo mẫu:\n${format.join("\n")}` : null,
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.vi : null,
      ]
    : [
        `You lead SEO content for ${input.site.name} (${input.site.baseUrl}).`,
        `Context: ${siteBrief(input.site)}`,
        "",
        `Plan a cluster of ${input.count} blog articles in English around the topic: "${input.topic.trim()}".`,
        "- Article 1 is the overview (pillar: yes) covering the whole topic. Each of the others (pillar: no) answers ONE specific question the website's readers (see the context) type into Google: how-to, comparison, cost, checklist, regulation, common mistake…",
        "- No two articles on the same point, and none repeating what the website already has.",
        "- title: phrased the way readers ask or search, about 70 characters at most. keyword: the 2–5 word phrase people really type to find it; each article its own phrase, none shared with another article of the cluster or the website.",
        "- A question too small for its own article goes into the outline of the closest one (its frequently asked questions), not into a separate article.",
        input.categories.length ? `- category: exactly one of: ${input.categories.join(" | ")}` : null,
        "- why: one sentence on who searches for it and what they need.",
        "- outline: 3–6 main section headings, phrased as the questions readers ask where it fits, separated by |.",
        existing.length ? `\nArticles the website already has (do not rewrite):\n${existing.map((t) => `- ${t}`).join("\n")}` : null,
        "",
        input.answer === "paste" ? `One block per article, in this format:\n${format.join("\n")}` : null,
        input.answer === "paste" ? "" : null,
        input.answer === "paste" ? ANSWER_RULE.en : null,
      ];
  // Omitted lines are null; empty strings are deliberate blank lines.
  return lines.filter((l) => l !== null).join("\n").trim();
}

export type PlanPasteError = "empty" | "isPrompt" | "nothing";

const KEYS: Record<string, keyof PlanIdea> = {
  title: "title",
  keyword: "focusKeyword",
  focuskeyword: "focusKeyword",
  category: "category",
  pillar: "pillar",
  why: "why",
  outline: "outline",
};

/** Reads the article blocks of an assistant's answer; a block needs at least a title. */
export function parseContentPlan(text: string): { ok: true; ideas: PlanIdea[] } | { ok: false; error: PlanPasteError } {
  const src = text.replace(/\r\n?/g, "\n").trim();
  if (!src) return { ok: false, error: "empty" };
  if (src.includes(ANSWER_RULE.vi) || src.includes(ANSWER_RULE.en)) return { ok: false, error: "isPrompt" };

  const ideas: PlanIdea[] = [];
  let current: PlanIdea | null = null;
  let inOutline = false;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const field = line.match(/^[-*]?\s*\**([A-Za-z]+)\**\s*:\s*(.*)$/);
    const key = field && KEYS[field[1].toLowerCase()];
    if (key) {
      const value = field[2].trim().replace(/^["'“]|["'”]$/g, "");
      if (key === "title") {
        current = { title: value, focusKeyword: "", category: "", pillar: false, why: "", outline: [] };
        ideas.push(current);
      } else if (current) {
        if (key === "pillar") current.pillar = /^(yes|true|có|x)$/i.test(value);
        else if (key === "outline") current.outline = value.split("|").map((h) => h.trim()).filter(Boolean);
        else current[key] = value;
      }
      inOutline = key === "outline" && !value;
      continue;
    }
    // An outline written as a list under "outline:".
    const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (inOutline && current && bullet) current.outline.push(bullet[1].trim());
    else if (line) inOutline = false;
  }
  const kept = ideas.filter((i) => i.title);
  return kept.length ? { ok: true, ideas: kept } : { ok: false, error: "nothing" };
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The body a planned draft starts with: why it is worth writing, then its section headings. */
export function outlineBody(idea: Pick<PlanIdea, "why" | "outline">, locale: Locale): { json: JSONContent; html: string } {
  const why = `${locale === "vi" ? "Vì sao nên viết" : "Why write this"}: ${idea.why.trim()}`;
  const headings = idea.outline.map((h) => h.trim()).filter(Boolean);
  const json: JSONContent = {
    type: "doc",
    content: [
      ...(idea.why.trim()
        ? [{ type: "callout", attrs: { variant: "info" }, content: [{ type: "paragraph", content: [{ type: "text", text: why }] }] }]
        : []),
      ...headings.map((h) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: h }] })),
    ],
  };
  const html = [
    idea.why.trim() ? `<div data-callout="" data-variant="info"><p>${escapeHtml(why)}</p></div>` : "",
    ...headings.map((h) => `<h2>${escapeHtml(h)}</h2>`),
  ].join("");
  return { json, html };
}
