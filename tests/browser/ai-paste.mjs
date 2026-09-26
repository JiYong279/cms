// "Your Claude" in the AI dialog, in a real Chrome/Edge: copy the prompt, paste an answer back,
// fill the article, then translate it the same way. Needs no API key.  npm run test:ai-paste
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

const VI_ANSWER = `Đây là bài viết:

---
title: Cách chọn phần mềm EMR cho phòng khám thẩm mỹ
excerpt: Năm tiêu chí giúp chủ phòng khám chọn đúng phần mềm hồ sơ bệnh án điện tử.
metaTitle: Chọn phần mềm EMR cho phòng khám thẩm mỹ
metaDescription: Năm tiêu chí chọn phần mềm hồ sơ bệnh án điện tử cho phòng khám thẩm mỹ, từ bảo mật, phân quyền tới chi phí và khả năng mở rộng.
focusKeyword: phần mềm EMR
category: Vận hành phòng khám
---

## Vì sao cần chọn kỹ

Đoạn mở đầu có **chữ đậm**.

> [!WARNING]
> Đừng lưu ảnh khách trên điện thoại cá nhân.

## So sánh

| Tiêu chí | Sổ giấy | EMR |
|---|---|---|
| Tìm hồ sơ | Chậm | Vài giây |

> [!TIP]
> **Điểm chính:** chọn phần mềm có phân quyền.`;

const EN_ANSWER = `---
title: How to Choose EMR Software for an Aesthetic Clinic
excerpt: Five criteria that help clinic owners pick the right electronic records software.
metaTitle: Choosing EMR Software for Aesthetic Clinics
metaDescription: Five criteria for choosing electronic medical records software for an aesthetic clinic, from security and access control to cost and growth.
focusKeyword: EMR software
---

## Why the choice matters

Opening paragraph with **bold text**.

> [!WARNING]
> Never keep client photos on personal phones.

## Comparison

| Criterion | Paper | EMR |
|---|---|---|
| Finding a record | Slow | Seconds |`;

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
await browser.defaultBrowserContext().overridePermissions(CMS, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("dialog", (d) => d.accept());
let postId;

/** Sets a React-controlled textarea the way a paste does. */
const paste = (selector, text) =>
  page.$eval(
    selector,
    (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    text,
  );
const field = (label) =>
  page.evaluate((text) => {
    const el = [...document.querySelectorAll("aside label")].find((l) => l.textContent.trim().startsWith(text))?.querySelector("select, textarea, input");
    return el?.tagName === "SELECT" ? el.options[el.selectedIndex].text : el?.value;
  }, label);
async function saveNow() {
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => {
    const text = document.querySelector("header").innerText;
    return text.includes("Đã lưu") && !text.includes("Chưa lưu");
  }, { timeout: 20000 });
}

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin?site=qubx`, { waitUntil: "networkidle0" });
  await page.click("button::-p-text(Viết bài mới)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  await page.click('[role="dialog"] input[value="qubx"]');
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button::-p-text(Tạo bài cho Qub-X)")]);
  postId = page.url().match(/posts\/([0-9a-f-]{36})/)?.[1];
  await page.waitForSelector(".ProseMirror");

  // 1. Draft with your own Claude
  await page.click("header button::-p-text(AI)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  const engine = await page.$eval('[role="dialog"] [role="radio"][aria-checked="true"]', (b) => b.textContent);
  if (engine !== "Claude của bạn") await page.click('[role="dialog"] [role="radio"]::-p-text(Claude của bạn)');
  expect("without an API key the dialog starts on 'Your Claude'", process.env.ANTHROPIC_API_KEY ? true : engine === "Claude của bạn", engine);
  await page.type('[role="dialog"] textarea', "Cách chọn phần mềm EMR");
  await page.click('[role="dialog"] button::-p-text(Copy câu lệnh)');
  await page.waitForSelector('[role="dialog"] details textarea');
  const prompt = await page.$eval('[role="dialog"] details textarea', (t) => t.value);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  // Windows turns line breaks on the clipboard into CRLF.
  expect("the prompt is on the clipboard", clipboard.split(String.fromCharCode(13)).join("") === prompt && prompt.length > 200, clipboard.slice(0, 80));
  expect("the prompt carries the topic, the categories and the format", prompt.includes("Chủ đề: Cách chọn phần mềm EMR") && prompt.includes("Vận hành phòng khám") && prompt.includes("metaDescription:") && prompt.includes("[!TIP]"));
  const pasteBox = '[role="dialog"] textarea[aria-label="Dán câu trả lời của Claude"]';
  expect("the dialog links to Claude", !!(await page.$('[role="dialog"] a[href="https://claude.ai/new"][target="_blank"]')));
  // Pasting the prompt itself, instead of Claude's answer, explains the step that was skipped.
  await paste(pasteBox, prompt);
  await page.waitForFunction(() => document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.includes("Đây là câu lệnh"));
  expect(
    "pasting the prompt back says it is the prompt and fills nothing",
    await page.$eval('[role="dialog"] button[type="submit"]', (b) => b.disabled),
  );
  await paste(pasteBox, VI_ANSWER);
  const found = () => [...document.querySelectorAll('[role="dialog"] [role="status"]')].find((p) => p.innerText.includes("Nhận được"))?.innerText;
  await page.waitForFunction(found);
  const summary = await page.evaluate(found);
  expect("pasting shows what was found", summary.includes("Cách chọn phần mềm EMR cho phòng khám thẩm mỹ") && summary.includes("2 mục") && summary.includes("Vận hành phòng khám"), summary);
  await shot(page, "paste-01-dialog");
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const vi = await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    return {
      title: document.querySelector("main textarea")?.value,
      h2: [...pm.querySelectorAll("h2")].map((h) => h.textContent),
      callouts: [...pm.querySelectorAll("[data-callout]")].map((c) => c.getAttribute("data-variant")),
      table: !!pm.querySelector("table"),
      bold: !!pm.querySelector("strong"),
    };
  });
  expect("the article is filled in", vi.title === "Cách chọn phần mềm EMR cho phòng khám thẩm mỹ" && vi.h2.join("|") === "Vì sao cần chọn kỹ|So sánh" && vi.table && vi.bold, JSON.stringify(vi));
  expect("the boxes become callouts", vi.callouts.join() === "warning,success", vi.callouts.join());
  expect("category and SEO fields are filled", (await field("Danh mục")) === "Vận hành phòng khám" && (await field("Mô tả SEO"))?.startsWith("Năm tiêu chí") && (await field("Từ khoá chính")) === "phần mềm EMR");
  await shot(page, "paste-02-filled");
  await saveNow();

  // 2. Translate it the same way
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('nav[aria-label="Ngôn ngữ"] a[href$="locale=en"]')]);
  await page.waitForSelector(".ProseMirror");
  await page.click("header button::-p-text(AI)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  if ((await page.$eval('[role="dialog"] [role="radio"][aria-checked="true"]', (b) => b.textContent)) !== "Claude của bạn") {
    await page.click('[role="dialog"] [role="radio"]::-p-text(Claude của bạn)');
  }
  await page.click('[role="dialog"] button::-p-text(Copy câu lệnh)');
  await page.waitForSelector('[role="dialog"] details textarea');
  const tPrompt = await page.$eval('[role="dialog"] details textarea', (t) => t.value);
  expect("the translation prompt carries the saved Vietnamese article", tPrompt.includes("Title: Cách chọn phần mềm EMR cho phòng khám thẩm mỹ") && tPrompt.includes("<h2>") && tPrompt.includes("into English"));
  await paste('[role="dialog"] textarea[aria-label="Dán câu trả lời của Claude"]', EN_ANSWER);
  await page.waitForFunction(() => document.querySelector('[role="dialog"] button[type="submit"]:not([disabled])'));
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  expect("the English version is filled in", (await page.$eval("main textarea", (t) => t.value)) === "How to Choose EMR Software for an Aesthetic Clinic");
  await saveNow();
  await page.reload({ waitUntil: "networkidle0" });
  expect("the pasted translation remembers its source (not marked out of date)", !(await page.$eval("main", (m) => m.innerText.includes("đã được sửa sau khi bản này được dịch"))));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "paste-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  if (postId) {
    const admin = new Client();
    await admin.login(ADMIN.email, ADMIN.password);
    await destroyPosts(admin, [postId]);
  }
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
