// "Fix with AI" in the SEO score, in a real Chrome/Edge, with "Your Claude" (copy and paste):
// an article with a 131-character SEO title and a 273-character description gets them rewritten,
// each suggestion reviewed before it goes into the editor.  npm run test:seo-fix
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, destroyPosts } from "../e2e/lib.mjs";

const OUT = new URL("./screenshots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.mkdirSync(OUT, { recursive: true });
const executablePath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find((p) => fs.existsSync(p));
if (!executablePath) throw new Error("No Chrome/Edge found; set CHROME_PATH");

let failures = 0;
const expect = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

const TITLE = "Cách chọn phần mềm quản lý spa cho chủ spa mới mở và những điều cần tránh khi mua phần mềm lần đầu tiên";
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
await admin.call(`/admin/posts/${postId}?locale=vi`, "savePost", [
  {
    postId, locale: "vi", status: "draft", title: TITLE, slug: "", excerpt: "",
    contentJson: null, contentHtml: "<h2>Vì sao cần chọn kỹ</h2><p>Phần mềm quản lý spa phù hợp giúp lễ tân tiết kiệm một giờ mỗi ngày.</p>",
    metaTitle: `${TITLE} - hướng dẫn chi tiết`, metaDescription: "Mô tả rất dài. ".repeat(18).trim(), focusKeyword: "phần mềm quản lý spa",
    noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
  },
]);

const NEW_TITLE = "Phần mềm quản lý spa: 5 tiêu chí chọn đúng ngay từ đầu";
const TOO_LONG = "Chọn phần mềm quản lý spa thế nào cho đúng? ".repeat(5).trim();
const GOOD_DESCRIPTION = "Chọn phần mềm quản lý spa thế nào để lễ tân bớt việc, khách không bị trùng lịch? Năm tiêu chí giúp chủ spa mới mở mua đúng ngay lần đầu.";
const ANSWER = [
  "Đây là phần SEO đã viết lại:",
  "```markdown",
  "---",
  `metaTitle: ${NEW_TITLE}`,
  `metaDescription: ${TOO_LONG}`,
  "excerpt: Năm tiêu chí giúp chủ spa mới mở chọn đúng phần mềm quản lý ngay lần đầu.",
  "---",
  "```",
].join("\n");

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));
const dialog = "[data-seo-fix]";
const score = () => page.$eval("[data-seo-score]", (el) => Number(el.getAttribute("data-seo-score")));
const checked = () => page.$$eval(`${dialog} input[data-field]:checked`, (els) => els.map((e) => e.getAttribute("data-field")));
async function paste(selector, value) {
  await page.$eval(
    selector,
    (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );
}

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-seo-score]");
  const before = await score();

  // One check: only its field is ticked.
  await page.click('[data-check="seoTitleLength"] [data-ai-fix]');
  await page.waitForSelector(dialog, { visible: true });
  expect("'Ask AI' on one check opens with just its field", (await checked()).join() === "metaTitle", (await checked()).join());
  await page.keyboard.press("Escape");
  await page.waitForFunction((d) => !document.querySelector(d), {}, dialog);

  // Everything at once.
  await page.click("[data-ai-fix-all]");
  await page.waitForSelector(dialog, { visible: true });
  const all = await checked();
  expect("'Fix with AI' ticks every field that fails", ["metaTitle", "metaDescription", "excerpt"].every((f) => all.includes(f)), all.join());
  await shot(page, "seo-fix-01-fields");

  await page.click(`${dialog} button::-p-text(Copy câu lệnh)`);
  await page.waitForSelector(`${dialog} details textarea`);
  const prompt = await page.$eval(`${dialog} details textarea`, (t) => t.value);
  expect("the prompt carries the article and the length rules", prompt.includes(TITLE) && prompt.includes("30–60 ký tự") && prompt.includes("110–160 ký tự"));
  expect("the dialog links to Claude", !!(await page.$(`${dialog} a[href="https://claude.ai/new"]`)));

  const pasteBox = `${dialog} textarea[placeholder^="---"]`;
  await paste(pasteBox, prompt);
  await page.waitForSelector(`${dialog} [role="alert"]`);
  expect("pasting the prompt itself is caught", (await page.$eval(`${dialog} [role="alert"]`, (e) => e.textContent)).includes("Đây là câu lệnh"));

  await paste(pasteBox, ANSWER);
  await page.waitForSelector(`${dialog} [data-proposals]`);
  const isUsed = async (field) => page.$eval(`${dialog} [data-proposal="${field}"] input[type="checkbox"]`, (c) => c.checked);
  expect("a suggestion of the right length is ticked", await isUsed("metaTitle"));
  expect("a suggestion too long is not ticked, and says so", !(await isUsed("metaDescription")) && (await page.$eval(`${dialog} [data-proposal="metaDescription"]`, (e) => e.innerText.includes("Chưa đúng độ dài"))));
  await shot(page, "seo-fix-02-proposals");

  // Adjust the long one by hand, then use it.
  await paste(`${dialog} [data-proposal="metaDescription"] textarea`, GOOD_DESCRIPTION);
  await page.click(`${dialog} [data-proposal="metaDescription"] input[type="checkbox"]`);
  const applyLabel = await page.$eval(`${dialog} button::-p-text(Dùng)`, (b) => b.textContent?.trim());
  await page.click(`${dialog} button::-p-text(Dùng)`);
  await page.waitForFunction((d) => !document.querySelector(d), {}, dialog);

  expect("the SEO title is filled in", (await page.$eval("#field-meta-title", (e) => e.value)) === NEW_TITLE);
  expect("the adjusted description is filled in", (await page.$eval("#field-meta-description", (e) => e.value)) === GOOD_DESCRIPTION);
  expect("the summary is filled in", (await page.$eval("#field-excerpt", (e) => e.value)).startsWith("Năm tiêu chí"));
  const after = await score();
  expect("the score goes up at once", after > before, `${before} -> ${after}`);
  expect("nothing is saved until the person saves", (await page.$eval("header", (h) => h.innerText)).includes("Chưa lưu"));
  expect("the button counted the fields to use", /^Dùng \d ô$/.test(applyLabel ?? ""), applyLabel);
  await page.evaluate(() => document.querySelector("#seo-score")?.scrollIntoView({ block: "start" }));
  await shot(page, "seo-fix-03-after");
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "seo-fix-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
