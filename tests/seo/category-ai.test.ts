// AI help with categories: the prompts, reading answers, and what each proposed category would change.
//   npx tsx tests/seo/category-ai.test.ts
import { categoryPlanPrompt, parseCategoryPlan, parsePlacements, placementPrompt, reviewCategoryPlan } from "../../src/lib/category-ai";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};

const site = { id: "qubx", name: "Qub-X", baseUrl: "https://www.qub-x.com", brief: { audience: "Chủ phòng khám thẩm mỹ" } };
const existing = [
  { id: "c1", nameVi: "Vận hành phòng khám", nameEn: "Clinic operations", posts: 4 },
  { id: "c2", nameVi: "Báo cáo & tăng trưởng", nameEn: "Reports & growth", posts: 2 },
  { id: "c3", nameVi: "Bảo mật", nameEn: "Security", posts: 1 },
  { id: "c4", nameVi: "Tuân thủ", nameEn: "Compliance", posts: 1 },
];
const titles = [{ title: "Hồ sơ bệnh án điện tử cho phòng khám", category: null }, { title: "Báo cáo doanh thu tháng", category: "Báo cáo & tăng trưởng" }];

const prompt = categoryPlanPrompt({ site, lang: "vi", existing, titles, answer: "paste" });
check("the prompt carries the brief, the categories with their counts and the articles", prompt.includes("Readers: Chủ phòng khám thẩm mỹ") && prompt.includes("- Vận hành phòng khám / Clinic operations (4 bài)") && prompt.includes("- Báo cáo doanh thu tháng [Báo cáo & tăng trưởng]"));
check("the API prompt leaves out the paste-back format", !categoryPlanPrompt({ site, lang: "vi", existing, titles, answer: "tool" }).includes("```markdown"));
check("an English prompt for an English interface", categoryPlanPrompt({ site, lang: "en", existing: [], titles: [], answer: "paste" }).includes("The website has no categories yet."));

const answer = [
  "```markdown",
  "### 1",
  "vi: Vận hành phòng khám",
  "en: Clinic operations",
  "about_vi: Quy trình hằng ngày.",
  "about_en: Daily routines.",
  "from: Vận hành phòng khám",
  "why: Vẫn hợp lý.",
  "",
  "### 2",
  "**vi**: Hồ sơ bệnh án điện tử",
  "**en**: Electronic medical records",
  "from:",
  "why: Nhiều người tìm.",
  "",
  "### 3",
  "vi: Bảo mật & tuân thủ",
  "en: Security & compliance",
  "from: Bảo mật | Tuân thủ",
  "",
  "### 4",
  "vi: Tăng trưởng doanh thu",
  "en: Reports & growth",
  "from: -",
  "",
  "### 5",
  "vi: Thiếu tên tiếng Anh",
  "```",
].join("\n");
const read = parseCategoryPlan(answer);
check("every block with both names is read", read.ok && read.ideas.length === 4, JSON.stringify(read).slice(0, 200));
check("descriptions and bold labels are read, an empty 'from' is a new topic", read.ok && read.ideas[0].descriptionEn === "Daily routines." && read.ideas[1].nameVi === "Hồ sơ bệnh án điện tử" && read.ideas[1].from.length === 0);
check("'from' lists several categories to merge", read.ok && read.ideas[2].from.join() === "Bảo mật,Tuân thủ");
check("pasting the prompt itself is recognised", (() => {
  const r = parseCategoryPlan(prompt);
  return !r.ok && r.error === "isPrompt";
})());

if (read.ok) {
  const review = reviewCategoryPlan(read.ideas, existing);
  const kinds = review.ideas.map((i) => i.kind).join();
  check("each idea says what it changes: keep, new, merge, rename", kinds === "keep,new,merge,rename", kinds);
  check("a renamed category is matched by its other name even without 'from'", review.ideas[3].existing[0]?.id === "c2");
  check("categories no idea continues are returned as advice", review.unused.length === 0, JSON.stringify(review.unused));
  const partial = reviewCategoryPlan(read.ideas.slice(0, 2), existing);
  check("…and listed when left out", partial.unused.map((c) => c.id).join() === "c2,c3,c4");
}

const articles = [
  { n: 1, title: "Hồ sơ bệnh án điện tử cho phòng khám", excerpt: "Cần lưu gì." },
  { n: 2, title: "Báo cáo doanh thu tháng", excerpt: "" },
  { n: 3, title: "Tuyển dụng lễ tân", excerpt: "" },
];
const categories = ["Vận hành phòng khám", "Báo cáo & tăng trưởng"];
const placePrompt = placementPrompt({ site, lang: "vi", categories, articles, answer: "paste" });
check("the placement prompt numbers the articles and lists the categories", placePrompt.includes("1. Hồ sơ bệnh án điện tử cho phòng khám — Cần lưu gì.") && placePrompt.includes("Danh mục: Vận hành phòng khám | Báo cáo & tăng trưởng"));
const placed = parsePlacements(["```text", "1: vận hành phòng khám", "2. **Báo cáo & tăng trưởng**", "3: -", "9: Vận hành phòng khám", "```"].join("\n"), articles, categories);
check(
  "placements are read case-insensitively; '-', unknown numbers and names are left out",
  placed.ok && placed.placements.size === 2 && placed.placements.get(1) === "Vận hành phòng khám" && placed.placements.get(2) === "Báo cáo & tăng trưởng",
  JSON.stringify(placed.ok && [...placed.placements]),
);
check("pasting the placement prompt is recognised", (() => {
  const r = parsePlacements(placePrompt, articles, categories);
  return !r.ok && r.error === "isPrompt";
})());

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
