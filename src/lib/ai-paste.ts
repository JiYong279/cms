import { marked } from "marked";
import type { Locale } from "@/db/schema";
import { siteBrief } from "./ai-brief";
import { SOURCE_RULES } from "./ai-sources";

/**
 * Writing with the person's own Claude (or any chat assistant) instead of the CMS's API:
 * the editor builds a prompt to copy into the chat, and reads the answer pasted back.
 * The answer is Markdown with a small front matter, the format chat assistants copy by default.
 */

export type PastedArticle = {
  title: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  html: string;
  /** The existing category named in the answer, if it matched one. */
  categoryId: string | null;
  categoryName: string;
  /** Level-2 sections found, for the summary shown before filling the editor. */
  sections: number;
};

/** "isPrompt": the prompt itself was pasted back instead of the AI's answer to it. */
export type PasteError = "empty" | "noTitle" | "noBody" | "isPrompt";

type Site = { id: string; name: string; baseUrl: string };
type Category = { id: string; name: string };

const LANGUAGE: Record<Locale, { vi: string; en: string }> = {
  vi: { vi: "tiếng Việt", en: "Vietnamese" },
  en: { vi: "tiếng Anh", en: "English" },
};

/** The title line of each format template: an answer carrying it is the template, not an article. */
const TEMPLATE_TITLE = { vi: "Tiêu đề bài (tối đa khoảng 70 ký tự)", en: "Article title (about 70 characters at most)" };

const FORMAT = {
  vi: (categories: Category[]) => `---
title: ${TEMPLATE_TITLE.vi}
excerpt: Tóm tắt 1–2 câu, hiện dưới tiêu đề
metaTitle: Tiêu đề SEO, dưới 60 ký tự
metaDescription: Mô tả SEO, 120–155 ký tự
focusKeyword: từ khoá chính
${categories.length ? `category: đúng một trong: ${categories.map((c) => c.name).join(" | ")}\n` : ""}---

## Mục đầu tiên

Nội dung…`,
  en: (categories: Category[]) => `---
title: ${TEMPLATE_TITLE.en}
excerpt: One or two sentence summary shown under the title
metaTitle: SEO title, under 60 characters
metaDescription: SEO description, 120–155 characters
focusKeyword: main search phrase
${categories.length ? `category: exactly one of: ${categories.map((c) => c.name).join(" | ")}\n` : ""}---

## First section

Text…`,
};

const RULES = {
  vi: `Yêu cầu trình bày:
- Mỗi mục lớn bắt đầu bằng "## ", mục con dùng "### ". Không dùng "# " và không lặp lại tiêu đề bài trong nội dung.
- Đoạn văn ngắn; dùng danh sách, **in đậm** và bảng Markdown khi so sánh.
- Khung nổi bật viết như sau (NOTE = thông tin, TIP = điểm chính, WARNING = lưu ý):
  > [!TIP]
  > Nội dung của khung.
- Đặt toàn bộ bài (từ dòng --- đầu tiên tới hết) trong MỘT khối code \`\`\`markdown, không tạo tài liệu hay artifact riêng, không thêm lời dẫn trước hay sau.`,
  en: `Formatting:
- Start every section with "## " and sub-sections with "### ". Do not use "# " and do not repeat the title in the body.
- Keep paragraphs short; use lists, **bold** and Markdown tables for comparisons.
- Write highlighted boxes like this (NOTE = information, TIP = key point, WARNING = caution):
  > [!TIP]
  > Text of the box.
- Put the whole article (from the first --- line to the end) in ONE \`\`\`markdown code block, not in a separate document or artifact, with nothing before or after it.`,
};

/** Prompt for a new article in `locale`. */
export function draftPrompt(input: {
  site: Site;
  locale: Locale;
  topic: string;
  keyPoints: string;
  focusKeyword: string;
  words: number;
  categories: Category[];
}) {
  const vi = input.locale === "vi";
  const points = input.keyPoints.trim();
  const lines = vi
    ? [
        `Bạn viết bài blog cho website ${input.site.name} (${input.site.baseUrl}).`,
        `Bối cảnh: ${siteBrief(input.site.id, input.site)}`,
        "",
        `Hãy viết một bài blog bằng ${LANGUAGE.vi.vi}, khoảng ${input.words} từ.`,
        `Chủ đề: ${input.topic.trim()}`,
        points ? `Các ý cần có:\n${points}` : null,
        input.focusKeyword.trim() ? `Từ khoá chính: ${input.focusKeyword.trim()}` : null,
        "",
        "Giọng văn rõ ràng, thân thiện, chuyên nghiệp; ưu tiên ví dụ cụ thể. Không bịa số liệu, giá, luật hay quy định; khi nội dung phụ thuộc vào quy định, nhắc người đọc kiểm tra văn bản hiện hành. Kết bài bằng một khung TIP tóm tắt điểm chính.",
        "",
        SOURCE_RULES.vi,
        "",
        RULES.vi,
        "",
        FORMAT.vi(input.categories),
      ]
    : [
        `You write blog articles for ${input.site.name} (${input.site.baseUrl}).`,
        `Context: ${siteBrief(input.site.id, input.site)}`,
        "",
        `Write a blog article in ${LANGUAGE.en.en}, about ${input.words} words long.`,
        `Topic: ${input.topic.trim()}`,
        points ? `Points to cover:\n${points}` : null,
        input.focusKeyword.trim() ? `Main search phrase: ${input.focusKeyword.trim()}` : null,
        "",
        "Clear, warm, professional voice; prefer concrete examples. Do not invent statistics, prices, laws or regulations; when a point depends on a regulation, tell readers to check the current text. End with a TIP box that sums up the key point.",
        "",
        SOURCE_RULES.en,
        "",
        RULES.en,
        "",
        FORMAT.en(input.categories),
      ];
  // Omitted lines are null; empty strings are deliberate blank lines.
  return lines.filter((l) => l !== null).join("\n");
}

/** Prompt translating the saved `from` version into `to`. */
export function translatePrompt(input: {
  site: Site;
  from: Locale;
  to: Locale;
  source: { title: string; excerpt: string; metaTitle: string; metaDescription: string; focusKeyword: string; html: string };
}) {
  const vi = input.to === "vi";
  const s = input.source;
  // Markdown answers drop pictures and videos unless told how to carry them over.
  const media = [
    /<img\b/i.test(s.html) &&
      (vi
        ? 'Giữ mọi ảnh ở đúng vị trí, viết thành ![mô tả ảnh đã dịch](đường dẫn giữ nguyên "chú thích đã dịch"); không đổi đường dẫn ảnh.'
        : 'Keep every image where it is, written as ![translated description](same address "translated caption"); never change the image address.'),
    /<a\b[^>]*\bhref=/i.test(s.html) &&
      (vi
        ? "Giữ mọi link và nguồn tham khảo, viết thành [chữ đã dịch](đường dẫn giữ nguyên); không đổi, không bỏ đường dẫn nào."
        : "Keep every link and source, written as [translated text](same address); never change or drop an address."),
    /data-youtube-video/.test(s.html) &&
      (vi
        ? "Giữ nguyên mọi video: chép nguyên thẻ <div data-youtube-video>…</div> vào đúng vị trí."
        : "Keep every video: copy its <div data-youtube-video>…</div> tag unchanged, in the same place."),
  ].filter((line) => typeof line === "string");
  const intro = vi
    ? [
        `Bạn dịch bài blog cho website ${input.site.name} (${input.site.baseUrl}).`,
        `Bối cảnh: ${siteBrief(input.site.id, input.site)}`,
        "",
        `Hãy dịch bài dưới đây từ ${LANGUAGE[input.from].vi} sang ${LANGUAGE[input.to].vi}, tự nhiên như người bản xứ viết, giữ nguyên ý, giọng văn và bố cục. Phần SEO (tiêu đề SEO, mô tả, từ khoá) hãy viết lại theo cách người đọc ${LANGUAGE[input.to].vi} sẽ tìm kiếm.`,
        "Nội dung bài đang ở dạng HTML: <h2>/<h3> là mục, <div data-callout data-variant=\"info|success|warning\"> là khung NOTE/TIP/WARNING.",
        ...media,
        "",
        RULES.vi,
        "",
        FORMAT.vi([]),
      ]
    : [
        `You translate blog articles for ${input.site.name} (${input.site.baseUrl}).`,
        `Context: ${siteBrief(input.site.id, input.site)}`,
        "",
        `Translate the article below from ${LANGUAGE[input.from].en} into ${LANGUAGE[input.to].en}, naturally, as a native writer would, keeping the meaning, tone and structure. Rewrite the SEO fields (SEO title, description, search phrase) the way ${LANGUAGE[input.to].en} readers would search.`,
        "The body is HTML: <h2>/<h3> are sections, <div data-callout data-variant=\"info|success|warning\"> are NOTE/TIP/WARNING boxes.",
        ...media,
        "",
        RULES.en,
        "",
        FORMAT.en([]),
      ];
  const article = [
    "",
    "=====",
    `Title: ${s.title}`,
    `Summary: ${s.excerpt}`,
    `SEO title: ${s.metaTitle}`,
    `SEO description: ${s.metaDescription}`,
    `Main search phrase: ${s.focusKeyword}`,
    "",
    s.html,
  ];
  return [...intro, ...article].join("\n");
}

const CALLOUTS: Record<string, string> = { NOTE: "info", TIP: "success", IMPORTANT: "success", WARNING: "warning", CAUTION: "warning" };
const FIELDS: Record<string, keyof PastedArticle> = {
  title: "title",
  excerpt: "excerpt",
  summary: "excerpt",
  metatitle: "metaTitle",
  metadescription: "metaDescription",
  focuskeyword: "focusKeyword",
  keyword: "focusKeyword",
  category: "categoryName",
};

/** Reads an answer in the format of FORMAT, forgiving the usual variations of chat assistants. */
export function parsePastedArticle(text: string, categories: Category[]): { ok: true; article: PastedArticle } | { ok: false; error: PasteError } {
  let src = text.replace(/\r\n?/g, "\n").trim();
  if (!src) return { ok: false, error: "empty" };
  // The instructions only the prompt carries: someone pasted it here instead of into the chat.
  if (src.includes(RULES.vi.split("\n").at(-1)!) || src.includes(RULES.en.split("\n").at(-1)!)) {
    return { ok: false, error: "isPrompt" };
  }

  // Inside a ```markdown block? Keep what the block holds.
  const fenced = src.match(/```[a-z]*\n([\s\S]*?)\n```/i);
  if (fenced && /^---\s*$/m.test(fenced[1])) src = fenced[1].trim();

  const fields: Record<string, string> = {};
  // Front matter: from the first "---" line (anything said before it is dropped) to the next one.
  const front = src.match(/(?:^|\n)---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (front) {
    for (const line of front[1].split("\n")) {
      const m = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*)$/);
      const key = m && FIELDS[m[1].toLowerCase()];
      if (key) fields[key] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    src = src.slice((front.index ?? 0) + front[0].length).trim();
  }

  // A leading "# Title" line is the title, not part of the body.
  const h1 = src.match(/^#\s+(.+)\n?/);
  if (h1) {
    fields.title ||= h1[1].trim();
    src = src.slice(h1[0].length).trim();
  }
  if (fields.title === TEMPLATE_TITLE.vi || fields.title === TEMPLATE_TITLE.en) return { ok: false, error: "isPrompt" };
  if (!fields.title) return { ok: false, error: "noTitle" };
  if (!src) return { ok: false, error: "noBody" };

  let html = marked.parse(src, { gfm: true, breaks: false, async: false });
  // > [!TIP] boxes become the editor's callouts.
  html = html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*([\s\S]*?)<\/blockquote>/gi,
    (_, kind: string, rest: string) => {
      const inner = rest.trim().startsWith("</p>") ? rest.trim().slice(4) : `<p>${rest}`;
      return `<div data-callout data-variant="${CALLOUTS[kind.toUpperCase()]}">${inner}</div>`;
    },
  );
  // Only two heading levels exist in articles: sections (H2) and sub-sections (H3).
  html = html.replace(/<(\/?)h1\b/g, "<$1h2").replace(/<(\/?)h[4-6]\b/g, "<$1h3");

  const wanted = (fields.categoryName ?? "").toLowerCase().trim();
  const category = categories.find((c) => c.name.toLowerCase().trim() === wanted);
  return {
    ok: true,
    article: {
      title: fields.title,
      excerpt: fields.excerpt ?? "",
      metaTitle: fields.metaTitle ?? "",
      metaDescription: fields.metaDescription ?? "",
      focusKeyword: fields.focusKeyword ?? "",
      html,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? fields.categoryName ?? "",
      sections: (html.match(/<h2\b/g) ?? []).length,
    },
  };
}
