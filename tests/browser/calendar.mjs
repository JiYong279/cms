// The editorial calendar in a real Chrome/Edge: a draft waits under "no date yet", is dragged onto a
// day, gets someone to look after it in the editor, and is dragged back. A scheduled article moves to
// another day at the same time; a published one stays and says why.  npm run test:calendar
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

// A scheduled and a published article, on days that are still to come and fall in one month.
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10);
const base = Number(today.slice(8, 10)) <= 24 ? today : nextMonth;
const FROM = addDays(base, 2);
const TO = addDays(base, 4);
const scheduleUrl = `${CMS}/admin/calendar?month=${FROM.slice(0, 7)}`;
async function makePost(title, status, scheduledAt) {
  const r = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
  const id = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
  await admin.call(`/admin/posts/${id}?locale=vi`, "savePost", [
    {
      postId: id, locale: "vi", status, title, slug: "", excerpt: "Thử lịch.", contentJson: null, contentHtml: "<p>Thử.</p>",
      metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt, categoryId: null, featured: false, coverImageUrl: "",
    },
  ]);
  return id;
}
// 09:30 in Vietnam.
const scheduledId = await makePost("Bài thử hẹn giờ trên lịch", "scheduled", `${FROM}T02:30:00Z`);
const publishedId = await makePost("Bài thử đã đăng trên lịch", "published", null);

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const card = `[data-post-id="${postId}"]`;
/** Drags a card (the draft's by default) onto a day cell or the "no date yet" column, as the browser does it. */
async function drag(target, from = card) {
  await page.$eval(from, (el) => el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })));
  await sleep(100);
  await page.$eval(target, (el) => {
    const dataTransfer = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });
  await page.$eval(from, (el) => el.dispatchEvent(new DragEvent("dragend", { bubbles: true })));
}
const statusText = () => page.$eval('[role="status"]', (el) => el.textContent ?? "");
const waitForStatus = (text) => page.waitForFunction((x) => document.querySelector('[role="status"]')?.textContent?.includes(x), { timeout: 15000 }, text);

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

  // A scheduled article moves to another day and keeps its time.
  const scheduled = `[data-post-id="${scheduledId}"]`;
  await page.goto(scheduleUrl, { waitUntil: "networkidle0" });
  expect("a scheduled article shows on its day", !!(await page.$(`[data-calendar-day="${FROM}"] ${scheduled}`)));
  await drag(`[data-calendar-day="${TO}"]`, scheduled);
  await waitForStatus("Đã dời lịch đăng");
  expect("dragging it confirms the new day at the same time", (await statusText()).includes("09:30"), await statusText());
  await page.reload({ waitUntil: "networkidle0" });
  const moved = await page.$(`[data-calendar-day="${TO}"] ${scheduled}`);
  expect("after reloading it is scheduled on the new day, still at 09:30", !!moved && (await moved.evaluate((el) => el.textContent ?? "")).includes("09:30"));
  await shot(page, "calendar-04-rescheduled");

  // It needs a day, and one still to come.
  await drag("aside[data-drop='unplanned']", scheduled);
  await waitForStatus("phải có ngày đăng");
  expect("a scheduled article cannot lose its day", !!(await page.$(`[data-calendar-day="${TO}"] ${scheduled}`)));
  const past = addDays(today, -1);
  if (await page.$(`[data-calendar-day="${past}"]`)) {
    await drag(`[data-calendar-day="${past}"]`, scheduled);
    await waitForStatus("thời điểm đã qua");
    expect("nor be moved to a day that has passed", !!(await page.$(`[data-calendar-day="${TO}"] ${scheduled}`)));
  }
  let s = await admin.call("/admin/calendar", "reschedulePost", [{ postId: scheduledId, from: TO, to: past }]);
  expect("the server refuses a day that has passed", s.ok === false && /thời điểm đã qua/.test(s.error), JSON.stringify(s));

  // A published article stays on its day and says how to change the date readers see.
  await page.goto(calendarUrl, { waitUntil: "networkidle0" });
  const published = `[data-post-id="${publishedId}"]`;
  expect("a published article shows on the day it went out", !!(await page.$(`[data-calendar-day="${today}"] ${published}`)));
  await drag(`[data-calendar-day="${today === DAY ? addDays(today, 1) : DAY}"]`, published);
  await waitForStatus("đã đăng nên không kéo");
  expect("trying to drag it explains it stays, and where to change its date", (await statusText()).includes("Ngày đăng") && !!(await page.$('[data-notice="locked"]')), await statusText());
  await shot(page, "calendar-05-published-locked");
  expect("it has not moved", !!(await page.$(`[data-calendar-day="${today}"] ${published}`)));
  s = await admin.call("/admin/calendar", "reschedulePost", [{ postId: publishedId, from: today, to: addDays(today, 3) }]);
  expect("the server does not move a published article either", s.ok === false, JSON.stringify(s));

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
  await destroyPosts(admin, [postId, scheduledId, publishedId].filter(Boolean));
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
