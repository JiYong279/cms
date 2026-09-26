// "Fix with AI" for the SEO score: fields per check, the prompt, and reading answers back.
//   npx tsx tests/seo/fix.test.ts
import { fieldsFor, parseSeoFix, seoFixPrompt, suggestSlug, withinLimits } from "../../src/lib/seo-fix";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};

const site = { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com" };
const article = {
  title: "Cách chọn phần mềm quản lý spa cho chủ spa mới mở và những điều cần tránh khi mua phần mềm lần đầu",
  excerpt: "",
  metaTitle: "Cách chọn phần mềm quản lý spa cho chủ spa mới mở và những điều cần tránh khi mua phần mềm lần đầu tiên",
  metaDescription: "",
  focusKeyword: "phần mềm quản lý spa",
  html: "<h2>Vì sao cần chọn kỹ</h2><p>Phần mềm phù hợp giúp lễ tân tiết kiệm một giờ mỗi ngày.</p><ul><li><p>Lịch hẹn</p></li></ul>",
};

check(
  "failing checks map to the fields that fix them, in a stable order",
  fieldsFor(["keywordInDescription", "seoTitleLength", "keywordInTitle", "excerpt", "coverImage" as never]).join() === "metaTitle,metaDescription,excerpt",
  fieldsFor(["keywordInDescription", "seoTitleLength", "keywordInTitle", "excerpt"]).join(),
);
check("slug checks are fixed by the slug, not by the AI", fieldsFor(["keywordInSlug", "slugLength"]).join() === "slug");

const prompt = seoFixPrompt({ site, locale: "vi", fields: ["metaTitle", "metaDescription"], article, answer: "paste" });
check("the prompt asks only for the chosen fields, with their lengths", prompt.includes("metaTitle:") && prompt.includes("30–60 ký tự") && prompt.includes("110–160 ký tự") && !prompt.includes("excerpt:"));
check("the prompt keeps the search phrase it is not asked to change", prompt.includes('Từ khoá chính của bài: "phần mềm quản lý spa"'));
check("the prompt carries the article as plain text", prompt.includes("## Vì sao cần chọn kỹ") && prompt.includes("tiết kiệm một giờ") && !prompt.includes("<p>"));
check("the API prompt leaves out the paste-back instructions", !seoFixPrompt({ site, locale: "vi", fields: ["metaTitle"], article, answer: "tool" }).includes("```markdown"));
check("an English article gets an English prompt", seoFixPrompt({ site, locale: "en", fields: ["excerpt"], article, answer: "paste" }).includes("in English"));

const answer = [
  "Đây là phần SEO đã viết lại:",
  "```markdown",
  "---",
  "metaTitle: Phần mềm quản lý spa: 5 tiêu chí chọn đúng ngay từ đầu",
  "metaDescription: Chọn phần mềm quản lý spa thế nào để lễ tân bớt việc, khách không bị trùng lịch? Năm tiêu chí giúp chủ spa mới mở mua đúng ngay lần đầu.",
  "excerpt: Không được hỏi nên bỏ qua.",
  "---",
  "```",
].join("\n");
const read = parseSeoFix(answer, ["metaTitle", "metaDescription"]);
check(
  "the answer is read from its code block",
  read.ok && read.values.metaTitle === "Phần mềm quản lý spa: 5 tiêu chí chọn đúng ngay từ đầu" && read.values.metaDescription?.startsWith("Chọn phần mềm quản lý spa") === true,
  JSON.stringify(read),
);
check("fields not asked for are ignored", read.ok && !("excerpt" in read.values));
check("a plain answer with bold labels is read too", (() => {
  const r = parseSeoFix("**metaTitle**: Tiêu đề mới cho bài", ["metaTitle"]);
  return r.ok && r.values.metaTitle === "Tiêu đề mới cho bài";
})());
const pastedPrompt = parseSeoFix(prompt, ["metaTitle", "metaDescription"]);
check("pasting the prompt itself is recognised", !pastedPrompt.ok && pastedPrompt.error === "isPrompt", JSON.stringify(pastedPrompt));
check("an answer without any asked field is refused", (() => {
  const r = parseSeoFix("Xin lỗi, tôi không hiểu yêu cầu.", ["metaTitle"]);
  return !r.ok && r.error === "nothing";
})());

check("lengths are checked like the score does", withinLimits("metaTitle", "x".repeat(45)) && !withinLimits("metaTitle", "x".repeat(131)) && !withinLimits("metaDescription", "x".repeat(273)) && withinLimits("metaDescription", "x".repeat(130)));
check("the slug comes from the search phrase", suggestSlug("Phần mềm quản lý spa") === "phan-mem-quan-ly-spa");

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
