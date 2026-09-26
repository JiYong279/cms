// The editor's back button returns to the page the article was opened from, filters included,
// whatever was done in the editor in between (switching language, saving).  npm run test:back
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, destroyPosts } from "../e2e/lib.mjs";

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

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
const TITLE = "Bài thử nút quay về";
await admin.call(`/admin/posts/${postId}?locale=vi`, "savePost", [
  {
    postId, locale: "vi", status: "draft", title: TITLE, slug: "", excerpt: "", contentJson: null, contentHtml: "<p>Thử.</p>",
    metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
  },
]);

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
const errors = [];
async function signedInPage() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
  page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  return page;
}
const here = (page) => page.url().replace(CMS, "");
async function openArticle(page) {
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(`a[href^="/admin/posts/${postId}"]`)]);
  await page.waitForSelector("header a[title]");
}
async function back(page) {
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("header a[title]")]);
  return here(page);
}

try {
  const page = await signedInPage();

  // A filtered, searched list.
  const list = `/admin?site=qubx&view=draft&q=${encodeURIComponent("thu nut quay ve")}`;
  await page.goto(CMS + list, { waitUntil: "networkidle0" });
  await openArticle(page);
  expect("back returns to the list with its filters and search", (await back(page)) === list, here(page));

  // Switching to the other language in between does not change where back goes.
  await openArticle(page);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('header nav a[href$="locale=en"]')]);
  expect("after switching language, back still returns to the list", (await back(page)) === list, here(page));

  // Opened from the activity log.
  const log = "/admin/activity?type=post";
  await page.goto(CMS + log, { waitUntil: "networkidle0" });
  await openArticle(page);
  expect("back returns to the activity log it was opened from", (await back(page)) === log, here(page));

  // Opened straight from an address in a new tab, which remembers nothing yet: back goes to the articles.
  const fresh = await page.browserContext().newPage();
  await fresh.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  expect("opened directly, back goes to the article list", (await back(fresh)) === "/admin", here(fresh));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
