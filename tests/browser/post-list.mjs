// In a real Chrome/Edge: the article list sorts by clicking its column headers, filters by the
// status of each language, and has a "Needs re-translation" tab. Writes screenshots for the pull request.
// npm run test:post-list
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS } from "../e2e/lib.mjs";

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

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const ORDER = ["draft", "in_review", "scheduled", "published", "archived", "none"];
const statuses = (locale) => page.$$eval(`tbody td[data-locale="${locale}"]`, (cells) => cells.map((c) => c.dataset.status));
const isOrdered = (list, dir) =>
  list.every((s, i) => i === 0 || (dir === "asc" ? ORDER.indexOf(list[i - 1]) <= ORDER.indexOf(s) : ORDER.indexOf(list[i - 1]) >= ORDER.indexOf(s)));
const params = () => new URL(page.url()).searchParams;
/** Links and the filters navigate inside the page (no reload): wait for the address, then the new list. */
const navigate = async (act) => {
  const before = page.url();
  await act();
  await page.waitForFunction((prev) => location.href !== prev, { timeout: 30000 }, before);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 });
};
const clickHeader = (label) =>
  navigate(() =>
    page.evaluate((label) => [...document.querySelectorAll("thead a[data-sort-link]")].find((a) => a.textContent.trim() === label)?.click(), label),
  );

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);

  await page.goto(`${CMS}/admin`, { waitUntil: "networkidle0" });
  const total = (await statuses("vi")).length;
  expect("the list has articles to sort", total >= 2, String(total));

  await clickHeader("Tiếng Việt");
  expect("clicking VI sorts by its status, draft first", params().get("sort") === "vi" && params().get("dir") === "asc" && isOrdered(await statuses("vi"), "asc"), (await statuses("vi")).join(","));
  expect("the sorted column says so", (await page.$eval('th[aria-sort="ascending"]', (th) => th.textContent.trim())) === "Tiếng Việt");
  await clickHeader("Tiếng Việt");
  expect("clicking it again reverses it", params().get("dir") === "desc" && isOrdered(await statuses("vi"), "desc"), (await statuses("vi")).join(","));
  await page.evaluate(() => document.querySelector("table")?.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${OUT}list-01-sorted-by-vi.png` });

  await clickHeader("Bài viết");
  // Untitled articles ("Chưa có tiêu đề", in italics) come last; compare the titled ones.
  const titles = await page.$$eval("tbody tr td:nth-child(2) span.line-clamp-1", (spans) =>
    spans.filter((s) => !s.parentElement?.classList.contains("italic")).map((s) => s.textContent.trim()),
  );
  const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
  expect("clicking Bài viết sorts titles A→Z", params().get("sort") === "title" && titles.every((t, i) => i === 0 || collator.compare(titles[i - 1], t) <= 0), titles.slice(0, 5).join(" | "));

  // EN version: Not written. The sort stays.
  await navigate(() => page.select('select[name="en"]', "none"));
  const en = await statuses("en");
  expect("filtering EN 'not written' keeps only articles without English", params().get("en") === "none" && en.every((s) => s === "none"), en.join(","));
  expect("the sort is kept while filtering", params().get("sort") === "title");
  expect("the active filter is shown with a way to clear it", (await page.$eval("body", (b) => b.innerText)).includes("Đang lọc:"));
  await page.screenshot({ path: `${OUT}list-02-filter-en-not-written.png` });
  await navigate(() => page.click("a::-p-text(Bỏ lọc)"));
  expect("clearing the filter keeps the sort", !params().get("en") && params().get("sort") === "title");

  // Needs re-translation: a tab, and the card above opens it.
  await navigate(() => page.click('nav a[href*="view=stale"]'));
  const staleRows = await page.$$eval("tbody tr", (rows) => rows.map((r) => r.innerText.includes("Cần dịch lại")));
  expect("the Needs re-translation tab lists only articles that need it", params().get("view") === "stale" && staleRows.every(Boolean), String(staleRows));
  expect("the stale card opens the same list", !!(await page.$('section a[href*="view=stale"]')));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await page.screenshot({ path: `${OUT}list-99-error.png` }).catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
