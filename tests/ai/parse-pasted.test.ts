// Reads chat-assistant answers the way the editor's "paste from AI" does:  npx tsx tests/ai/parse-pasted.test.ts
import { draftPrompt, parsePastedArticle, translatePrompt } from "../../src/lib/ai-paste";

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

const FENCE = "`".repeat(3);
check("the prompt asks for the article in one code block (chat apps give it a Copy button)", prompt.includes(`MỘT khối code ${FENCE}markdown`));
const wrapped = parsePastedArticle(
  ["Đây là bài viết:", "", `${FENCE}markdown`, "---", "title: Bài trong khối code", "excerpt: Tóm tắt.", "---", "", "## Mục một", "", "Nội dung.", FENCE, "", "Bạn muốn chỉnh gì thêm không?"].join("\n"),
  categories,
);
check("an answer in a code block, with words before and after it, is read", wrapped.ok && wrapped.article.title === "Bài trong khối code" && wrapped.article.sections === 1, JSON.stringify(wrapped).slice(0, 160));

// Pasting the prompt itself instead of the AI answer must not fill the article with the template.
const site = { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com" };
const source = { title: "Chọn phần mềm spa", excerpt: "Tóm tắt.", metaTitle: "", metaDescription: "", focusKeyword: "", html: "<h2>Mục</h2><p>Nội dung.</p>" };
for (const [label, text] of [
  ["draft prompt (vi)", prompt],
  ["translate prompt (vi to en)", translatePrompt({ site, from: "vi", to: "en", source })],
  ["translate prompt (en to vi)", translatePrompt({ site, from: "en", to: "vi", source })],
] as const) {
  const pasted = parsePastedArticle(text, categories);
  check(`pasting the ${label} itself is recognised as the prompt`, !pasted.ok && pasted.error === "isPrompt", JSON.stringify(pasted).slice(0, 120));
}

// Translating with your own Claude keeps the pictures and videos of the article.
{
  const site = { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com" };
  const html = [
    "<h2>Mục</h2><p>Nội dung.</p>",
    '<img src="https://cdn.qub-x.com/cms/2026/09/le-tan-a1b2c3d4.webp" alt="Lễ tân đón khách" title="Quầy lễ tân">',
    '<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></div>',
  ].join("");
  const withMedia = translatePrompt({
    site, from: "vi", to: "en",
    source: { title: "Bài có ảnh", excerpt: "", metaTitle: "", metaDescription: "", focusKeyword: "", html },
  });
  check(
    "the translation prompt asks to keep every image, translating its description",
    withMedia.includes("Keep every image where it is") && withMedia.includes("![translated description](same address"),
  );
  check("the translation prompt asks to keep videos as they are", withMedia.includes("Keep every video"));
  const noMedia = translatePrompt({
    site, from: "vi", to: "en",
    source: { title: "Bài chữ", excerpt: "", metaTitle: "", metaDescription: "", focusKeyword: "", html: "<h2>Mục</h2><p>Chữ.</p>" },
  });
  check("an article without images or videos gets no instructions about them", !noMedia.includes("Keep every image") && !noMedia.includes("Keep every video"));

  const answer = [
    "---", "title: Article with pictures", "excerpt: Summary.", "---", "", "## Section", "", "Text.", "",
    '![Receptionist welcoming a client](https://cdn.qub-x.com/cms/2026/09/le-tan-a1b2c3d4.webp "Front desk")',
    "",
    '<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></div>',
  ].join("\n");
  const read = parsePastedArticle(answer, categories);
  const out = read.ok ? read.article.html : "";
  check(
    "a pasted image keeps its address, its translated description and caption",
    /<img[^>]+src="https:\/\/cdn\.qub-x\.com\/cms\/2026\/09\/le-tan-a1b2c3d4\.webp"/.test(out) && out.includes('alt="Receptionist welcoming a client"') && out.includes('title="Front desk"'),
    out.slice(0, 300),
  );
  check("a pasted video is kept", out.includes("data-youtube-video") && out.includes("youtube-nocookie.com/embed/dQw4w9WgXcQ"), out.slice(0, 300));
}

// Outside facts carry a link to where they come from, official sources first, never made up.
check(
  "the draft prompt asks to link every outside fact, official sources first, never inventing links",
  prompt.includes("Dẫn nguồn (bắt buộc)") && prompt.includes("moh.gov.vn") && prompt.includes("không bịa link") && prompt.includes("## Nguồn tham khảo"),
);
{
  const site = { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com" };
  const linked = translatePrompt({
    site, from: "vi", to: "en",
    source: { title: "Bài có nguồn", excerpt: "", metaTitle: "", metaDescription: "", focusKeyword: "", html: '<p>Theo <a href="https://moh.gov.vn/">Bộ Y tế</a>.</p>' },
  });
  check("a translation keeps every link and source", linked.includes("Keep every link and source"));
  const answer = ["---", "title: Bài có nguồn", "---", "", "## Mục", "", "Theo [Bộ Y tế](https://moh.gov.vn/), …", "", "## Nguồn tham khảo", "", "- [Bộ Y tế](https://moh.gov.vn/)"].join("\n");
  const read = parsePastedArticle(answer, categories);
  const html = read.ok ? read.article.html : "";
  check(
    "a pasted source link becomes a real link, and the sources get their own section",
    html.includes('<a href="https://moh.gov.vn/">Bộ Y tế</a>') && html.includes("<h2>Nguồn tham khảo</h2>"),
    html.slice(0, 300),
  );
}

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
