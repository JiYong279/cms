// How AI drafts are written for search: the SEO rules, pillar vs supporting articles, internal links.
//   npx tsx tests/seo/ai-seo.test.ts
import { draftPrompt } from "../../src/lib/ai-paste";
import { linkRules, seoWritingRules } from "../../src/lib/ai-seo";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};

const vi = seoWritingRules("vi", "cluster");
check("the rules ask for an opening that answers, question headings and a FAQ", vi.includes("Câu đầu tiên của bài trả lời thẳng") && vi.includes("đề mục thành câu hỏi") && vi.includes("## Câu hỏi thường gặp"));
check("the rules follow the SEO score's lengths", vi.includes("30–60 ký tự") && vi.includes("110–160 ký tự") && vi.includes("Ít nhất 3 mục"));
check("the rules ask for something other pages lack, and the product at most once", vi.includes("thứ riêng mà trang khác không có") && vi.includes("tối đa một lần"));
check("a narrative outline (agency style) is turned into the article's structure", vi.includes("dàn ý kể chuyện"));
check("a supporting article stays on one question, a pillar covers the topic", vi.includes("MỘT câu hỏi") && seoWritingRules("vi", "pillar").includes("BÀI TRỤ CỘT"));
check("the English rules work for Markdown and HTML headings", seoWritingRules("en", "pillar").includes("<h2>") && seoWritingRules("en", "pillar").includes("PILLAR"));

const targets = [
  { title: "Hồ sơ bệnh án điện tử: hướng dẫn đầy đủ", url: "https://www.qub-x.com/vi/blog/ho-so-benh-an-dien-tu", pillar: true },
  { title: "Chi phí EMR", url: "https://www.qub-x.com/vi/blog/chi-phi-emr", pillar: false },
];
const links = linkRules("vi", targets, "cluster");
check("the website's articles are listed with their addresses, the pillar starred", links.includes("- ★ Hồ sơ bệnh án điện tử: hướng dẫn đầy đủ — https://www.qub-x.com/vi/blog/ho-so-benh-an-dien-tu") && links.includes("- Chi phí EMR — "));
check("a supporting article must link back to its pillar", links.includes("Luôn dẫn một link về bài trụ cột"));
check("the pillar itself is not asked to link to a pillar", !linkRules("vi", targets, "pillar").includes("Luôn dẫn một link về bài trụ cột"));
check("anchor text is the target's title, never 'here'", links.includes("không dùng \"tại đây\""));
check("no articles, no link section", linkRules("vi", [], "cluster") === "");

const site = { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com", brief: { framework: "Bối cảnh → Vấn đề → Giải pháp → CTA" } };
const prompt = draftPrompt({ site, locale: "vi", topic: "Dữ liệu khách hàng phân tán", keyPoints: "Context: …\nCTA: …", focusKeyword: "quản lý dữ liệu khách hàng", words: 900, categories: [], kind: "cluster", links: targets });
check("the copied prompt carries the rules, the links and the brief's preferred structure", prompt.includes("Tối ưu cho Google") && prompt.includes("★ Hồ sơ bệnh án điện tử") && prompt.includes("Preferred article structure: Bối cảnh → Vấn đề → Giải pháp → CTA"));
check("the summary box comes before the FAQ", prompt.includes("Ngay trước mục Câu hỏi thường gặp, đặt một khung TIP"));

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
