// The editorial calendar in a real Chrome/Edge: a draft waits under "no date yet", is dragged onto a
// day, gets someone to look after it in the editor, and is dragged back.  npm run test:calendar
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, EDITOR, destroyPosts } from "../e2e/lib.mjs";

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
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A draft with a title, made through the same Server Action the editor uses.
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
const TITLE = "Bài thử lịch biên tập";
await admin.call(`/admin/posts/${postId}?locale=vi`, "savePost", [
  {
    postId, locale: "vi", status: "draft", title: TITLE, slug: "", excerpt: "", contentJson: null, contentHtml: "<p>Thử.</p>",
    metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
  },
]);

const month = new Date().toISOString().slice(0, 7);
const DAY = `${month}-15`;
const calendarUrl = `${CMS}/admin/calendar?month=${month}`;

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const card = `[data-post-id="${postId}"]`;
/** Drags the article's card onto a day cell or the "no date yet" column, as the browser does it. */
async function drag(target) {
  await page.$eval(card, (el) => el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })));
  await sleep(100);
  await page.$eval(target, (el) => {
    const dataTransfer = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });
  await page.$eval(card, (el) => el.dispatchEvent(new DragEvent("dragend", { bubbles: true })));
}
const statusText = () => page.$eval('[role="status"]', (el) => el.textContent ?? "");

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);

  await page.goto(`${CMS}/admin`, { waitUntil: "networkidle0" });
  expect("the article list offers the calendar view", !!(await page.$('nav a[href="/admin/calendar"]')));
  await page.click('nav a[href="/admin/calendar"]');
  await page.waitForSelector("[data-calendar-day]");
  expect("the calendar opens on the current month", (await page.$eval("[data-month]", (el) => el.getAttribute("data-month"))) === month);

  await page.goto(calendarUrl, { waitUntil: "networkidle0" });
  expect("a draft without a day waits under 'no date yet'", !!(await page.$(`[data-unplanned-list] ${card}`)));

  await drag(`[data-calendar-day="${DAY}"]`);
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("Đã dời"), { timeout: 15000 });
  expect("dragging it onto a day confirms the move", (await statusText()).includes(TITLE), await statusText());
  await page.reload({ waitUntil: "networkidle0" });
  expect("after reloading it stays on that day", !!(await page.$(`[data-calendar-day="${DAY}"] ${card}`)));
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), `[data-calendar-day="${DAY}"]`);
  await shot(page, "calendar-01-month");

  // The editor's "Plan" section shows the day and lets an admin pick who looks after it.
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  expect("the editor shows the planned day", (await page.$eval("#field-planned-for", (el) => el.value)) === DAY);
  const editorOption = await page.$$eval("#field-assignee option", (os, name) => os.find((o) => o.textContent === name)?.value, EDITOR.name);
  await page.select("#field-assignee", editorOption);
  await page.waitForFunction(() => document.querySelector("#planning [aria-live]")?.textContent?.includes("Đã lưu kế hoạch"), { timeout: 15000 });
  expect("choosing who looks after it saves at once", true);
  await page.$eval("#planning", (el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "calendar-02-editor-plan");

  await page.goto(calendarUrl, { waitUntil: "networkidle0" });
  expect("the card shows who looks after it", (await page.$eval(`${card} [title]`, (el) => el.getAttribute("title"))) === `Phụ trách: ${EDITOR.name}`);

  await drag("aside[data-drop='unplanned']");
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("Đã bỏ ngày dự kiến"), { timeout: 15000 });
  await page.reload({ waitUntil: "networkidle0" });
  expect("dragging it back to 'no date yet' removes the day", !!(await page.$(`[data-unplanned-list] ${card}`)));

  // Phones get the month as a list of days.
  await admin.call("/admin/calendar", "planPost", [{ postId, plannedFor: DAY }]);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(calendarUrl, { waitUntil: "networkidle0" });
  const visibleCard = await page.$$eval(card, (els) => els.some((el) => el.offsetParent !== null));
  expect("on a phone the planned article shows in the day list", visibleCard);
  expect("on a phone the page does not scroll sideways", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot(page, "calendar-03-phone", { fullPage: true });
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "calendar-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
