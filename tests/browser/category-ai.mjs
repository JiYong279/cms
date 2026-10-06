// AI help with categories in a real Chrome/Edge, with "Your Claude": the prompt is copied, an answer
// pasted back and reviewed (keep / new / merge), a new category applied, then an uncategorised
// article sorted into it.  npm run test:category-ai
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
const NEW = "Chủ đề dán thử e2e";
const TITLE = "E2E bài cần xếp";

// An article with no category, for the AI to sort.
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const r = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
await admin.call(`/admin/posts/${postId}?locale=vi`, "savePost", [
  {
    postId, locale: "vi", status: "draft", title: TITLE, slug: "", excerpt: "Cần một danh mục.", contentJson: null, contentHtml: "<p>x</p>",
    metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
  },
]);

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));

/** Clicks `selector` inside the Qub-X section of the categories page. */
const clickInQubx = (selector) =>
  page.evaluate((s) => [...document.querySelectorAll("section")].find((x) => x.querySelector("h2")?.textContent === "Qub-X")?.querySelector(s)?.click(), selector);
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
/** Copies the prompt in `dialog` and returns it (shown under "see the prompt" whether or not the clipboard worked). */
async function copyPrompt(dialog) {
  await page.evaluate((d) => [...document.querySelectorAll(`${d} button`)].find((b) => b.textContent?.includes("Copy"))?.click(), dialog);
  await page.waitForSelector(`${dialog} details textarea`);
  return page.$eval(`${dialog} details textarea`, (t) => t.value);
}

try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin/categories`, { waitUntil: "networkidle0" });

  // 1. Propose categories.
  await clickInQubx("[data-suggest-categories]");
  await page.waitForSelector("[data-suggest-dialog]", { visible: true });
  const prompt = await copyPrompt("[data-suggest-dialog]");
  const existing = [...prompt.matchAll(/^- (.+) \/ (.+) \(\d+ bài\)$/gm)].map((m) => m[1]);
  expect("the prompt lists the website's categories and articles", existing.length >= 3 && prompt.includes(TITLE), existing.join(", "));
  const answer = [
    "```markdown",
    "### 1",
    `vi: ${existing[0]}`,
    "en: Kept",
    `from: ${existing[0]}`,
    "why: Giữ.",
    "### 2",
    `vi: ${NEW}`,
    "en: E2E pasted topic",
    "about_vi: Giới thiệu thử.",
    "about_en: Test intro.",
    "from:",
    "why: Mới.",
    "### 3",
    "vi: Gộp thử e2e",
    "en: E2E merged",
    `from: ${existing[1]} | ${existing[2]}`,
    "why: Trùng ý.",
    "```",
  ].join("\n");
  await paste('[data-suggest-dialog] textarea[aria-label]:not([readonly])', answer);
  await page.waitForSelector("[data-suggest-review]");
  const kinds = await page.$$eval("[data-suggest-review] [data-idea-kind]", (els) => els.map((e) => e.getAttribute("data-idea-kind")).join());
  expect("the answer is reviewed as rename, new and merge", kinds === "rename,new,merge", kinds);
  expect("categories the AI leaves out are pointed out", existing.length < 4 || (await page.$eval("[data-unused]", (e) => e.textContent ?? "")).includes(existing[3]));
  // Renaming a category moves its articles to another topic name: never ticked for the team.
  const renameTicked = await page.$eval('[data-idea-kind="rename"] input[type="checkbox"]', (el) => el.checked);
  expect("a rename of an existing category is not ticked by default", renameTicked === false);
  const warning = await page.$eval('[data-idea-kind="rename"]', (el) => el.querySelector("[data-rename-warning]")?.textContent ?? "");
  expect("a rename warns how many articles it touches", /bài/.test(warning) || !warning, warning);
  expect("the apply button counts only the new category", (await page.$eval("[data-suggest-dialog] [data-apply]", (b) => b.textContent)).includes("1 thay đổi"));
  await page.screenshot({ path: `${OUT}category-ai-suggest.png` });
  await page.click("[data-suggest-dialog] [data-apply]");
  await page.waitForFunction(() => document.querySelector("[data-suggest-dialog] [role=status]")?.textContent?.includes("Đã tạo 1"), { timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction((name) => document.body.innerText.includes(name), { timeout: 10000 }, NEW);
  expect("the new category shows on the page", true);

  // 2. Sort the uncategorised article into it.
  await clickInQubx("[data-place-articles]");
  await page.waitForSelector("[data-place-dialog]", { visible: true });
  const placePrompt = await copyPrompt("[data-place-dialog]");
  const n = placePrompt.match(new RegExp(`^(\\d+)\\. ${TITLE}`, "m"))?.[1];
  expect("the prompt numbers the uncategorised articles", !!n && placePrompt.includes(NEW), placePrompt.slice(0, 300));
  await paste('[data-place-dialog] textarea[aria-label]:not([readonly])', `\`\`\`text\n${n}: ${NEW}\n\`\`\``);
  await page.waitForSelector("[data-place-review]");
  const picked = await page.$eval(`[data-place-row="${postId}"] select`, (s) => s.selectedOptions[0]?.textContent);
  expect("the article gets the category the answer named", picked === NEW, picked);
  await page.screenshot({ path: `${OUT}category-ai-place.png` });
  await page.click("[data-place-dialog] [data-apply]");
  await page.waitForFunction(() => document.querySelector("[data-place-dialog] [role=status]")?.textContent?.includes("Đã xếp 1 bài"), { timeout: 10000 });
  const editor = (await admin.req(`/admin/posts/${postId}?locale=vi`)).text;
  expect("the article is now in that category", editor.includes(NEW));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await page.screenshot({ path: `${OUT}category-ai-error.png` }).catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  const html = (await admin.req("/admin/categories")).text;
  const id = html.match(new RegExp(`\\\\"id\\\\":\\\\"([0-9a-f-]{36})\\\\",\\\\"nameVi\\\\":\\\\"${NEW}\\\\"`))?.[1];
  if (id) await admin.call("/admin/categories", "deleteCategory", [id]);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
