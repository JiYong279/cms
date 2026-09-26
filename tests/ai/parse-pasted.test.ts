// Reads chat-assistant answers the way the editor's "paste from AI" does:  npx tsx tests/ai/parse-pasted.test.ts
import { draftPrompt, parsePastedArticle } from "../../src/lib/ai-paste";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};
const categories = [
  { id: "c1", name: "Vận hành phòng khám" },
  { id: "c2", name: "Hồ sơ bệnh án điện tử (EMR)" },
];

const answer = [
  "Dưới đây là bài viết theo đúng khuôn bạn yêu cầu:",
  "",
  "```markdown",
  "---",
  "title: Cách chọn phần mềm EMR cho phòng khám thẩm mỹ",
  "excerpt: Năm tiêu chí giúp chủ phòng khám chọn đúng phần mềm.",
  "metaTitle: Chọn phần mềm EMR cho phòng khám thẩm mỹ",
  "metaDescription: Năm tiêu chí chọn phần mềm hồ sơ bệnh án điện tử cho phòng khám thẩm mỹ, từ bảo mật tới chi phí và khả năng mở rộng.",
  "focusKeyword: phần mềm EMR",
  "category: hồ sơ bệnh án điện tử (emr)",
  "---",
  "",
  "# Cách chọn phần mềm EMR cho phòng khám thẩm mỹ",
  "",
  "## Vì sao cần chọn kỹ",
  "",
  "Đoạn mở đầu có **chữ đậm** và [liên kết](https://www.qub-x.com/vi/features/customer-records).",
  "",
  "> [!WARNING]",
  "> Đừng lưu ảnh khách trên điện thoại cá nhân.",
  "",
  "## So sánh",
  "",
  "| Tiêu chí | Sổ giấy | EMR |",
  "|---|---|---|",
  "| Tìm hồ sơ | Chậm | Vài giây |",
  "",
  "#### Chi tiết nhỏ",
  "",
  "- Ý một",
  "- Ý hai",
  "",
  "> [!TIP]",
  "> **Điểm chính:** chọn phần mềm có phân quyền.",
  "```",
  "",
  "Chúc bạn viết bài thành công!",
].join("\n");

const r = parsePastedArticle(answer, categories);
check("the answer is read", r.ok, JSON.stringify(r));
if (r.ok) {
  const a = r.article;
  check("front matter fills the fields", a.title === "Cách chọn phần mềm EMR cho phòng khám thẩm mỹ" && a.focusKeyword === "phần mềm EMR" && a.metaDescription.startsWith("Năm tiêu chí"));
  check("the category matches regardless of case", a.categoryId === "c2", a.categoryName);
  check("the repeated # title is not in the body", !a.html.includes("<h1") && !a.html.includes(">Cách chọn phần mềm EMR cho phòng khám thẩm mỹ<"));
  check("sections are H2, deeper headings become H3", a.sections === 2 && a.html.includes("<h3>Chi tiết nhỏ</h3>") && !/<h4/.test(a.html), a.html);
  check("[!WARNING] and [!TIP] become callouts", a.html.includes('data-variant="warning"') && a.html.includes('data-variant="success"') && !a.html.includes("[!"), a.html);
  check("tables, bold and links survive", a.html.includes("<table>") && a.html.includes("<strong>chữ đậm</strong>") && a.html.includes('href="https://www.qub-x.com/vi/features/customer-records"'));
  check("text after the block is dropped", !a.html.includes("Chúc bạn"));
}

// Without front matter: a "# Title" still works.
const plain = parsePastedArticle("# Tiêu đề trơn\n\n## Mục một\n\nNội dung.", categories);
check("a plain Markdown answer works too", plain.ok && plain.article.title === "Tiêu đề trơn" && plain.article.sections === 1);
check("an empty paste is refused", !parsePastedArticle("  ", categories).ok);
check("a paste without a title is refused", (() => { const x = parsePastedArticle("Chỉ có một đoạn văn.", categories); return !x.ok && x.error === "noTitle"; })());

const prompt = draftPrompt({
  site: { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com" },
  locale: "vi",
  topic: "Cách chọn phần mềm EMR",
  keyPoints: "",
  focusKeyword: "",
  words: 1200,
  categories,
});
check("the prompt lists the categories and the format", prompt.includes("Vận hành phòng khám | Hồ sơ bệnh án điện tử (EMR)") && prompt.includes("metaDescription:") && prompt.includes("> [!TIP]"));
check("the prompt leaves out empty options", !prompt.includes("Các ý cần có") && !prompt.includes("Từ khoá chính:"));

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
