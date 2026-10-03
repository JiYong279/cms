// The SEO score of an article version:  npx tsx tests/seo/score.test.ts
import { scoreArticle, type ScoreInput } from "../../src/lib/seo-score";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};
const earned = (input: ScoreInput, id: string) => scoreArticle(input).checks.find((c) => c.id === id)!.earned;

const empty: ScoreInput = {
  title: "",
  metaTitle: "",
  excerpt: "",
  metaDescription: "",
  focusKeyword: "",
  slug: "",
  html: "",
  categoryId: null,
  coverImageUrl: null,
  coverImageAlt: "",
  pillar: false,
  authorHasProfile: false,
  translationInSync: false,
  siteHost: "www.qub-x.com",
};
const e = scoreArticle(empty);
check("an empty article scores low and is 'weak'", e.score < 15 && e.level === "weak", String(e.score));
check("an empty article has no check met", e.checks.every((c) => c.earned === 0), e.checks.filter((c) => c.earned > 0).map((c) => c.id).join(", "));

const paragraph = (n: number, extra = "") => `<p>${extra}${" chữ".repeat(n)}</p>`;
const full: ScoreInput = {
  title: "Cách chọn phần mềm EMR cho phòng khám thẩm mỹ",
  metaTitle: "Chọn phần mềm EMR cho phòng khám thẩm mỹ",
  excerpt: "Năm tiêu chí giúp chủ phòng khám chọn đúng.",
  metaDescription: "Năm tiêu chí chọn phần mềm EMR cho phòng khám thẩm mỹ, từ bảo mật, phân quyền tới chi phí và khả năng mở rộng khi mở thêm chi nhánh.",
  focusKeyword: "Phần mềm EMR",
  slug: "cach-chon-phan-mem-emr",
  html: [
    paragraph(60, "Chọn <strong>phần mềm EMR</strong> đúng giúp phòng khám "),
    "<h2>Vì sao phần mềm EMR quan trọng</h2>",
    paragraph(120),
    '<p>Xem <a href="/vi/features/customer-records">hồ sơ khách hàng</a> và <a href="https://www.qub-x.com/vi/pricing">bảng giá</a>, hoặc <a href="https://example.com">nguồn ngoài</a>.</p>',
    "<h2>Tiêu chí</h2>",
    paragraph(140),
    paragraph(140),
    "<h2>Triển khai</h2>",
    paragraph(140),
    paragraph(140),
    paragraph(140),
    paragraph(140),
    '<img src="https://x/a.webp" alt="Màn hình hồ sơ">',
  ].join(""),
  categoryId: "c1",
  coverImageUrl: "https://x/cover.webp",
  coverImageAlt: "Lễ tân đón khách tại quầy",
  pillar: false,
  authorHasProfile: true,
  translationInSync: true,
  siteHost: "www.qub-x.com",
};
const f = scoreArticle(full);
check("a complete article scores 100 and is 'good'", f.score === 100 && f.level === "good", `${f.score}: ${f.checks.filter((c) => c.earned < 1).map((c) => c.id).join(", ")}`);

check("keyword matching ignores case", earned(full, "keywordInTitle") === 1 && earned(full, "keywordInIntro") === 1 && earned(full, "keywordInHeading") === 1);
check("internal links: relative and same-site count, other sites do not", scoreArticle(full).checks.find((c) => c.id === "internalLinks")!.vars.n === 2);
check("one internal link gives half the points", earned({ ...full, html: '<p><a href="/vi/pricing">giá</a></p>' }, "internalLinks") === 0.5);
check("an image without alt text fails its check", earned({ ...full, html: full.html + '<img src="https://x/b.webp" alt="">' }, "imagesAlt") === 0);
check("840 words are enough for a supporting article", earned({ ...full, html: paragraph(140).repeat(6) }, "wordCount") === 1);
check("…but give a pillar article half the points: it covers a whole topic", earned({ ...full, pillar: true, html: paragraph(140).repeat(6) }, "wordCount") === 0.5);
check("a supporting article under 600 words gets half, under 360 none", earned({ ...full, html: paragraph(140).repeat(3) }, "wordCount") === 0.5 && earned({ ...full, html: paragraph(140).repeat(2) }, "wordCount") === 0);
check("the check says which length it asked for", scoreArticle({ ...full, pillar: true }).checks.find((c) => c.id === "wordCount")!.vars.min === 1200);
check("a paragraph over 150 words fails the short-paragraph check", earned({ ...full, html: full.html + paragraph(200) }, "shortParagraphs") === 0);
check("an SEO title over 60 characters fails, the title is used when it is empty", earned({ ...full, metaTitle: "x".repeat(61) }, "seoTitleLength") === 0 && earned({ ...full, metaTitle: "" }, "seoTitleLength") === 1);
check("without a keyword every keyword check fails", ["keywordSet", "keywordInTitle", "keywordInSlug", "keywordInIntro"].every((id) => earned({ ...full, focusKeyword: "" }, id) === 0));
const noExtras = scoreArticle({ ...full, coverImageUrl: null, authorHasProfile: false, translationInSync: false });
check("cover, author and translation are worth 15 points", noExtras.score === 85, String(noExtras.score));

check("a cover without a description counts as an image without one", earned({ ...full, coverImageAlt: "" }, "imagesAlt") === 0 && earned(full, "imagesAlt") === 1);

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
