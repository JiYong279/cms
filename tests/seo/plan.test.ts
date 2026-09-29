// "Plan with AI" on the calendar: planned days, the prompt, reading answers, the outline body.
//   npx tsx tests/seo/plan.test.ts
import { contentPlanPrompt, outlineBody, parseContentPlan, planDates } from "../../src/lib/content-plan";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};

// 2026-10-02 is a Friday.
check("weekdays skip the weekend", planDates("2026-10-02", 3, "weekdays").join() === "2026-10-02,2026-10-05,2026-10-06", planDates("2026-10-02", 3, "weekdays").join());
check("daily is every day", planDates("2026-10-02", 3, "daily").join() === "2026-10-02,2026-10-03,2026-10-04");
check("three a week is Monday, Wednesday, Friday", planDates("2026-10-02", 4, "threePerWeek").join() === "2026-10-02,2026-10-05,2026-10-07,2026-10-09", planDates("2026-10-02", 4, "threePerWeek").join());
check("twice a week is Tuesday and Thursday", planDates("2026-10-02", 2, "twoPerWeek").join() === "2026-10-06,2026-10-08");
check("weekly keeps the start's day", planDates("2026-10-02", 3, "weekly").join() === "2026-10-02,2026-10-09,2026-10-16");
check("month and year ends roll over", planDates("2026-12-31", 2, "daily").join() === "2026-12-31,2027-01-01");

const site = { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com" };
const prompt = contentPlanPrompt({
  site, locale: "vi", topic: "Hồ sơ bệnh án điện tử", count: 12,
  categories: ["Vận hành phòng khám", "Hồ sơ bệnh án điện tử (EMR)"],
  existing: ["Hồ sơ bệnh án điện tử (EMR) cho phòng khám thẩm mỹ: bắt đầu từ đâu?"],
  answer: "paste",
});
check("the prompt asks for a cluster of that many articles on the topic", prompt.includes("một cụm 12 bài") && prompt.includes('"Hồ sơ bệnh án điện tử"'));
check("the prompt lists the categories and the articles not to repeat", prompt.includes("Vận hành phòng khám | Hồ sơ bệnh án điện tử (EMR)") && prompt.includes("- Hồ sơ bệnh án điện tử (EMR) cho phòng khám thẩm mỹ: bắt đầu từ đâu?"));
check("the API prompt leaves out the paste-back format", !contentPlanPrompt({ site, locale: "vi", topic: "EMR", count: 3, categories: [], existing: [], answer: "tool" }).includes("```markdown"));
check("an English plan gets an English prompt", contentPlanPrompt({ site, locale: "en", topic: "EMR", count: 3, categories: [], existing: [], answer: "paste" }).includes("in English"));

const answer = [
  "Đây là kế hoạch:",
  "```markdown",
  "### 1",
  "title: Hồ sơ bệnh án điện tử: hướng dẫn đầy đủ cho phòng khám",
  "keyword: hồ sơ bệnh án điện tử",
  "category: Hồ sơ bệnh án điện tử (EMR)",
  "pillar: yes",
  "why: Chủ phòng khám cần hiểu toàn cảnh trước hạn chót.",
  "outline: EMR là gì | Ai bắt buộc | Lộ trình triển khai",
  "",
  "### 2",
  "**title**: Chi phí triển khai EMR cho phòng khám nhỏ",
  "keyword: chi phí emr",
  "pillar: no",
  "why: Người đang so sánh giá.",
  "outline:",
  "- Các khoản chi",
  "- Cách tiết kiệm",
  "",
  "### 3",
  "keyword: thiếu tiêu đề",
  "```",
].join("\n");
const read = parseContentPlan(answer);
check("every block with a title is read", read.ok && read.ideas.length === 2, JSON.stringify(read).slice(0, 200));
check(
  "fields are read, the outline split on |",
  read.ok && read.ideas[0].pillar && read.ideas[0].focusKeyword === "hồ sơ bệnh án điện tử" && read.ideas[0].category === "Hồ sơ bệnh án điện tử (EMR)" && read.ideas[0].outline.join("/") === "EMR là gì/Ai bắt buộc/Lộ trình triển khai",
);
check("an outline written as a list is read, bold labels too", read.ok && !read.ideas[1].pillar && read.ideas[1].title === "Chi phí triển khai EMR cho phòng khám nhỏ" && read.ideas[1].outline.join("/") === "Các khoản chi/Cách tiết kiệm");
const pastedPrompt = parseContentPlan(prompt);
check("pasting the prompt itself is recognised", !pastedPrompt.ok && pastedPrompt.error === "isPrompt");
check("an answer without articles is refused", (() => {
  const r = parseContentPlan("Xin lỗi, tôi cần thêm thông tin.");
  return !r.ok && r.error === "nothing";
})());

const body = outlineBody({ why: "Người đang so sánh <giá> & tính năng.", outline: ["Các khoản chi", "Cách tiết kiệm"] }, "vi");
check("the draft starts with why it matters, then the headings", body.json.content?.[0]?.type === "callout" && body.json.content?.[1]?.type === "heading" && body.json.content?.length === 3);
check("its HTML is escaped", body.html.includes("so sánh &lt;giá&gt; &amp; tính năng") && body.html.includes("<h2>Cách tiết kiệm</h2>"), body.html);

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
