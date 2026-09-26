// Translating either way from the AI dialog, in a real Chrome/Edge: from the Vietnamese version,
// "Vietnamese → English" saves it and opens the English one with the translation ready to paste.
//   npm run test:translate
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

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
const TITLE_VI = "Chọn phần mềm quản lý spa";
const TITLE_EN = "Choosing spa management software";
const ANSWER = `---
title: ${TITLE_EN}
excerpt: Five things to check before you buy.
---

## Why it matters

The right software saves every receptionist an hour a day.`;

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));
page.on("dialog", (d) => d.accept());
const dialog = '[role="dialog"]';
const checkedDirection = () => page.$eval(`${dialog} [role="radiogroup"] [aria-checked="true"][data-direction]`, (b) => b.getAttribute("data-direction")).catch(() => null);

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);

  // Write the Vietnamese version, leave it unsaved.
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");
  await page.type("#field-title", TITLE_VI);
  await page.click(".ProseMirror");
  await page.keyboard.type("Phần mềm phù hợp giúp lễ tân tiết kiệm một giờ mỗi ngày.");

  await page.click("header button::-p-text(AI)");
  await page.waitForSelector(dialog, { visible: true });
  await page.click(`${dialog} label::-p-text(Dịch bài)`);
  expect("with Vietnamese written, the direction starts at Vietnamese → English", (await checkedDirection()) === "out", await checkedDirection());
  expect("English → Vietnamese is off while there is no English version", await page.$eval(`${dialog} [data-direction="into"]`, (b) => b.disabled));
  const button = await page.$eval(`${dialog} button[type="submit"]`, (b) => b.textContent?.trim());
  expect("unsaved changes: the button saves first", button === "Lưu rồi mở bản English", button);
  expect("no warning that this version will be replaced", !(await page.$eval(dialog, (d) => d.innerText.includes("sẽ được thay"))));
  await shot(page, "translate-01-direction");

  await Promise.all([page.waitForFunction(() => location.search.includes("locale=en"), { timeout: 20000 }), page.click(`${dialog} button[type="submit"]`)]);
  await page.waitForSelector(dialog, { visible: true, timeout: 20000 });
  expect("the English version opens with the dialog translating", (await checkedDirection()) === "into", await checkedDirection());
  expect("from Vietnamese into English", await page.$eval(`${dialog} [data-direction="into"]`, (b) => b.innerText.replace(/\s+/g, " ").trim() === "Tiếng Việt English"));
  await page.waitForFunction(() => !location.search.includes("ai="), { timeout: 5000 });
  expect("the address no longer asks to open the dialog", true);

  // "Your Claude": the prompt carries the saved Vietnamese version.
  if ((await page.$eval(`${dialog} [role="radio"][aria-checked="true"]:not([data-direction])`, (b) => b.textContent)) !== "Claude của bạn") {
    await page.click(`${dialog} [role="radio"]::-p-text(Claude của bạn)`);
  }
  await page.click(`${dialog} button::-p-text(Copy câu lệnh)`);
  await page.waitForSelector(`${dialog} details textarea`, { timeout: 15000 });
  const prompt = await page.$eval(`${dialog} details textarea`, (t) => t.value);
  expect("the Vietnamese version was saved and goes into the prompt", prompt.includes(TITLE_VI), prompt.slice(0, 200));

  await page.$eval(
    `${dialog} textarea[aria-label="Dán câu trả lời của Claude"]`,
    (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    ANSWER,
  );
  await page.waitForFunction((d) => document.querySelector(`${d} button[type="submit"]:not([disabled])`), {}, dialog);
  await page.click(`${dialog} button[type="submit"]`);
  await page.waitForFunction((d) => !document.querySelector(d), {}, dialog);
  expect("the English translation fills the English version", (await page.$eval("#field-title", (el) => el.value)) === TITLE_EN);
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector("header").innerText.includes("Đã lưu") && !document.querySelector("header").innerText.includes("Chưa lưu"), { timeout: 20000 });

  // Each version keeps its own text.
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  expect("the Vietnamese version is unchanged", (await page.$eval("#field-title", (el) => el.value)) === TITLE_VI);
  await page.click("header button::-p-text(AI)");
  await page.waitForSelector(dialog, { visible: true });
  await page.click(`${dialog} label::-p-text(Dịch bài)`);
  expect("now both directions are possible", !(await page.$eval(`${dialog} [data-direction="into"]`, (b) => b.disabled)) && !(await page.$eval(`${dialog} [data-direction="out"]`, (b) => b.disabled)));
  expect("nothing unsaved: the button just opens the English version", (await page.$eval(`${dialog} button[type="submit"]`, (b) => b.textContent?.trim())) === "Mở bản English để dịch");
  await shot(page, "translate-02-both-ways");
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "translate-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
