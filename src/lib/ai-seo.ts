import type { Locale } from "@/db/schema";
import { MAX_PARAGRAPH_WORDS, META_DESCRIPTION_LENGTH, MIN_INTERNAL_LINKS, MIN_SECTIONS, SEO_TITLE_LENGTH } from "./seo-score";

/**
 * How AI drafts are written for search: Google and the AI assistants that quote pages. The rules
 * follow the SEO score's checks, so a draft starts close to "good", plus what makes a page worth
 * ranking or quoting: an opening that answers, question headings, something no other page has, and
 * links to the website's own articles. No server-only code: the editor builds prompts with it.
 */

/** "pillar": the overview of its topic; "cluster": one article answering one question of it. */
export type ArticleKind = "pillar" | "cluster";

/** A live article of the website the draft may link to. */
export type LinkTarget = { title: string; url: string; pillar: boolean };

export const MAX_LINK_TARGETS = 25;

export function seoWritingRules(locale: Locale, kind: ArticleKind) {
  const t = SEO_TITLE_LENGTH;
  const d = META_DESCRIPTION_LENGTH;
  if (locale === "vi") {
    return [
      "Tối ưu cho Google và trợ lý AI (tự nhiên, không nhồi từ khoá):",
      "- Câu đầu tiên của bài trả lời thẳng câu hỏi của người tìm kiếm, không rào đón. Từ khoá chính xuất hiện tự nhiên trong 100 chữ đầu.",
      `- Tiêu đề viết theo cách người đọc hỏi hoặc gõ tìm, có từ khoá chính. Tiêu đề SEO ${t.min}–${t.max} ký tự; mô tả SEO ${d.min}–${d.max} ký tự, có từ khoá và lý do để bấm vào.`,
      `- Ít nhất ${MIN_SECTIONS} mục "##". Khi hợp lý, đặt đề mục thành câu hỏi người đọc hay hỏi, và câu đầu tiên dưới đề mục trả lời ngay bằng chính các từ của câu hỏi. Ít nhất một đề mục có từ khoá hoặc biến thể gần.`,
      `- Mỗi đoạn tối đa khoảng ${Math.round(MAX_PARAGRAPH_WORDS * 0.8)} chữ.`,
      "- Bài phải có ít nhất một thứ riêng mà trang khác không có: bảng so sánh, checklist, các bước cụ thể, hoặc ví dụ tính bằng số (ghi rõ là ví dụ, giả định nếu không có nguồn).",
      '- Kết thúc bằng mục "## Câu hỏi thường gặp" gồm 3–5 câu hỏi "###", mỗi câu trả lời 1–3 câu.',
      "- Sản phẩm của website chỉ nhắc tối đa một lần, gần cuối, như một lựa chọn chứ không quảng cáo.",
      kind === "pillar"
        ? "- Đây là BÀI TRỤ CỘT của chủ đề: bao quát toàn bộ chủ đề, mỗi ý lớn một mục, nói đủ để người đọc hiểu bức tranh chung."
        : "- Đây là bài vệ tinh: trả lời thật kỹ MỘT câu hỏi, không lan sang chủ đề khác. Ngắn gọn và cụ thể tốt hơn dài.",
      '- Nếu "Các ý cần có" là một dàn ý kể chuyện (bối cảnh, vấn đề, hậu quả, nhận định, giải pháp, thông điệp, CTA…): giữ đúng mạch đó, nhưng viết thành các đề mục như trên; phần giải pháp ngắn và ở gần cuối; kết bằng thông điệp chính và lời kêu gọi.',
      '- Nếu bối cảnh có "Preferred article structure", theo khung đó.',
    ].join("\n");
  }
  return [
    "Optimise for Google and AI assistants (naturally, no keyword stuffing):",
    "- The first sentence answers the searcher's question outright, with no warm-up. The main search phrase appears naturally in the first 100 words.",
    `- Phrase the title the way readers ask or search, with the main search phrase. SEO title ${t.min}–${t.max} characters; SEO description ${d.min}–${d.max} characters, with the phrase and a reason to click.`,
    `- At least ${MIN_SECTIONS} sections (## in Markdown, <h2> in HTML). Where it fits, make a heading the question readers ask, and answer it in the first sentence below using the same words. At least one heading holds the phrase or a close variant.`,
    `- Paragraphs of about ${Math.round(MAX_PARAGRAPH_WORDS * 0.8)} words at most.`,
    "- Give the article at least one thing other pages lack: a comparison table, a checklist, concrete steps, or a worked example with numbers (marked as an example or assumption when unsourced).",
    '- End with a "Frequently asked questions" section, headed in the article\'s language (## / <h2>), of 3–5 questions as sub-headings (### / <h3>), each answered in 1–3 sentences.',
    "- Mention the website's product at most once, near the end, as an option rather than an advert.",
    kind === "pillar"
      ? "- This is the PILLAR article of its topic: cover the whole topic, one section per main point, enough for readers to see the full picture."
      : "- This is a supporting article: answer ONE question thoroughly and stay on it. Short and specific beats long.",
    '- If the points to cover are a narrative outline (context, problem, consequences, insight, solution, key message, CTA…): keep that flow, written as the headings above; keep the solution short and near the end; close with the key message and the call to action.',
    '- If the context gives a "Preferred article structure", follow it.',
  ].join("\n");
}

/** The website's articles to link to, the topic's pillar first; empty when there are none. */
export function linkRules(locale: Locale, targets: LinkTarget[], kind: ArticleKind) {
  if (targets.length === 0) return "";
  const list = targets.slice(0, MAX_LINK_TARGETS).map((a) => `- ${a.pillar ? "★ " : ""}${a.title} — ${a.url}`);
  const pillar = kind === "cluster" && targets.some((a) => a.pillar);
  if (locale === "vi") {
    return [
      `Link nội bộ: chèn ${MIN_INTERNAL_LINKS}–3 link tới các bài dưới đây của website, chỉ ở chỗ thật sự liên quan. Chữ gắn link là tiêu đề hoặc cụm từ khoá của bài được dẫn tới, không dùng "tại đây", "xem thêm".`,
      pillar ? "Luôn dẫn một link về bài trụ cột (★) cùng chủ đề." : null,
      "Chỉ dùng đúng các đường dẫn này, không tự tạo đường dẫn khác của website:",
      ...list,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }
  return [
    `Internal links: add ${MIN_INTERNAL_LINKS}–3 links to the website's articles below, only where genuinely relevant. The linked words are the target's title or main phrase, never "here" or "read more".`,
    pillar ? "Always include one link to the pillar article (★) of the same topic." : null,
    "Use these addresses exactly; never invent other addresses on the website:",
    ...list,
  ]
    .filter((l) => l !== null)
    .join("\n");
}
