// "Plan with AI" on the calendar, in a real Chrome/Edge, with "Your Claude": a cluster is proposed,
// reviewed (a duplicate dropped), and the kept ideas land as drafts on their days, ready to draft
// from their outline.  npm run test:content-plan
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
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts });

// An article the plan must not repeat.
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const existing = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const existingId = existing.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
const EXISTING = "Bài đã có về lịch hẹn spa";
await admin.call(`/admin/posts/${existingId}?locale=vi`, "savePost", [
  {
    postId: existingId, locale: "vi", status: "draft", title: EXISTING, slug: "", excerpt: "", contentJson: null, contentHtml: "<p>Thử.</p>",
    metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
  },
]);

const TOPIC = "Quản lý lịch hẹn cho spa";
const ANSWER = [
  "```markdown",
  "### 1",
  "title: Quản lý lịch hẹn spa: hướng dẫn đầy đủ",
  "keyword: quản lý lịch hẹn spa",
  "pillar: yes",
  "why: Chủ spa muốn hết cảnh trùng lịch.",
  "outline: Vì sao lịch hẹn hay rối | Các cách quản lý | Chọn phần mềm",
  "",
  "### 2",
  `title: ${EXISTING}`,
  "keyword: lịch hẹn spa",
  "pillar: no",
  "why: Trùng với bài đã có.",
  "outline: Một | Hai",
  "",
  "### 3",
  "title: Nhắc lịch khách qua Zalo: mẫu tin nhắn hiệu quả",
  "keyword: nhắc lịch hẹn zalo",
  "pillar: no",
  "why: Lễ tân cần mẫu tin nhắn dùng ngay.",
  "outline: Khi nào nên nhắc | Mẫu tin nhắn | Lỗi hay gặp",
  "```",
].join("\n");

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));
const dialog = "[data-plan-dialog]";
async function setValue(selector, value) {
  await page.$eval(
    selector,
    (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    },
    value,
  );
}
const created = [];

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin/calendar?site=qubx`, { waitUntil: "networkidle0" });

  await page.click("[data-plan-ai]");
  await page.waitForSelector(dialog, { visible: true });
  await setValue(`${dialog} textarea[placeholder^="Ví dụ"]`, TOPIC);
  await setValue(`${dialog} input[type="number"]`, "3");
  await setValue(`${dialog} input[type="date"]`, "2031-06-02");
  // The rhythm is the select offering "threePerWeek".
  await page.$$eval(`${dialog} select`, (selects) => {
    const rhythm = selects.find((s) => [...s.options].some((o) => o.value === "threePerWeek"));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(rhythm, "threePerWeek");
    rhythm.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await shot(page, "plan-01-request");

  await page.click(`${dialog} button::-p-text(Copy câu lệnh)`);
  await page.waitForSelector(`${dialog} details textarea`);
  const prompt = await page.$eval(`${dialog} details textarea`, (t) => t.value);
  expect("the prompt asks for a cluster of 3 articles on the topic", prompt.includes("một cụm 3 bài") && prompt.includes(TOPIC));
  expect("the prompt lists the articles the website already has", prompt.includes(`- ${EXISTING}`));

  await setValue(`${dialog} textarea[placeholder^="### 1"]`, ANSWER);
  await page.waitForSelector("[data-plan-review]");
  const days = () => page.$$eval("[data-plan-review] [data-day]", (els) => els.map((e) => e.getAttribute("data-day")));
  expect("three ideas, on Monday, Wednesday and Friday", (await days()).join() === "2031-06-02,2031-06-04,2031-06-06", (await days()).join());
  expect("the overview is marked", await page.$eval('[data-idea="0"]', (e) => e.innerText.includes("Bài tổng quan")));
  expect("an idea repeating an existing article is flagged", await page.$eval('[data-idea="1"]', (e) => e.innerText.includes("Trùng tiêu đề")));
  await shot(page, "plan-02-review", { fullPage: true });

  await page.click('[data-idea="1"] input[type="checkbox"]');
  expect("dropping an idea moves the next one up", (await days()).join() === "2031-06-02,2031-06-04", (await days()).join());
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click(`${dialog} button::-p-text(Tạo 2 bài nháp)`),
  ]);
  expect("the calendar opens on the plan's month", (await page.$eval("[data-month]", (e) => e.getAttribute("data-month"))) === "2031-06");
  const onDay = (day) => page.$$eval(`[data-calendar-day="${day}"] [data-post-id]`, (els) => els.map((e) => ({ id: e.getAttribute("data-post-id"), text: e.textContent })));
  const first = await onDay("2031-06-02");
  const second = await onDay("2031-06-04");
  created.push(...first.map((c) => c.id), ...second.map((c) => c.id));
  expect("each kept idea is a draft on its day", first.some((c) => c.text.includes("Quản lý lịch hẹn spa")) && second.some((c) => c.text.includes("Nhắc lịch khách qua Zalo")));
  await shot(page, "plan-03-calendar");

  // The draft starts from its outline, and the AI dialog picks it up.
  const id = first.find((c) => c.text.includes("Quản lý lịch hẹn spa")).id;
  await page.goto(`${CMS}/admin/posts/${id}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");
  const body = await page.$eval(".ProseMirror", (e) => ({ h2: [...e.querySelectorAll("h2")].map((h) => h.textContent), callout: e.querySelector("[data-callout]")?.textContent }));
  expect("the draft holds its outline and why it matters", body.h2.join("|") === "Vì sao lịch hẹn hay rối|Các cách quản lý|Chọn phần mềm" && body.callout?.includes("Chủ spa muốn hết cảnh trùng lịch"), JSON.stringify(body));
  expect("the search phrase is filled in", (await page.$eval("#field-keyword", (e) => e.value)) === "quản lý lịch hẹn spa");
  await page.click("header button::-p-text(AI)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  if (await page.$('[role="dialog"] label::-p-text(Viết bản nháp)')) await page.click('[role="dialog"] label::-p-text(Viết bản nháp)');
  const prefilled = await page.$$eval('[role="dialog"] textarea', (ts) => ts.map((t) => t.value));
  expect("'Write a draft' starts from the title and the outline", prefilled[0] === "Quản lý lịch hẹn spa: hướng dẫn đầy đủ" && prefilled[1] === "Vì sao lịch hẹn hay rối\nCác cách quản lý\nChọn phần mềm", JSON.stringify(prefilled.slice(0, 2)));
  await shot(page, "plan-04-draft-from-outline");
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "plan-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, [existingId, ...created].filter(Boolean));
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
