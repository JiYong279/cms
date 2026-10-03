// The SEO score in a real Chrome/Edge: it starts low, the publish dialog warns, filling the
// article raises it live, and the article list shows it.  npm run test:seo-score
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

// A long article (about 1,100 words over 4 sections) with two links to the site.
const words = (n) => Array.from({ length: n }, (_, i) => `chữ${i % 7}`).join(" ");
const ANSWER = `---
title: Cách chọn phần mềm EMR cho phòng khám thẩm mỹ
excerpt: Năm tiêu chí giúp chủ phòng khám chọn đúng phần mềm hồ sơ bệnh án điện tử.
metaTitle: Chọn phần mềm EMR cho phòng khám thẩm mỹ
metaDescription: Năm tiêu chí chọn phần mềm EMR cho phòng khám thẩm mỹ, từ bảo mật, phân quyền tới chi phí và khả năng mở rộng khi mở thêm chi nhánh.
focusKeyword: phần mềm EMR
category: Vận hành phòng khám
---

Chọn đúng phần mềm EMR giúp phòng khám ${words(80)}.

## Vì sao phần mềm EMR quan trọng

${words(130)}

Xem [hồ sơ khách hàng](/vi/features/customer-records) và [bảng giá](https://www.qub-x.com/vi/pricing).

## Tiêu chí

${words(140)}

${words(140)}

## Triển khai

${words(140)}

${words(140)}

## Chi phí

${words(140)}

${words(140)}`;

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()} (${m.location()?.url})`));
page.on("dialog", (d) => d.accept());
let postId;

const score = () => page.$eval("[data-seo-score]", (el) => Number(el.getAttribute("data-seo-score")));
const todo = () => page.$$eval("[data-check]", (els) => els.map((el) => el.getAttribute("data-check")));

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
  // A new article opens with the AI dialog; this test goes on without it.
  await page.waitForSelector('[role="dialog"]', { visible: true });
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  postId = page.url().match(/posts\/([0-9a-f-]{36})/)?.[1];
  await page.waitForSelector("[data-seo-score]");

  const start = await score();
  expect("an empty article scores low", start < 15, String(start));
  await page.click("header button::-p-text(Đăng bài)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  expect("the publish dialog warns about a low score, and still allows publishing", await page.$eval('[role="dialog"]', (d) => d.innerText.includes("Điểm SEO của bản này mới đạt") && !d.querySelector('button[type="submit"]').disabled));
  await page.keyboard.press("Escape");

  // Fill the article through "Your Claude" (paste an answer).
  await page.click("header button::-p-text(AI)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  if ((await page.$eval('[role="dialog"] [role="radio"][aria-checked="true"]', (b) => b.textContent)) !== "Claude của bạn") {
    await page.click('[role="dialog"] [role="radio"]::-p-text(Claude của bạn)');
  }
  await page.$eval(
    '[role="dialog"] textarea[aria-label="Dán câu trả lời của Claude"]',
    (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    ANSWER,
  );
  await page.waitForFunction(() => document.querySelector('[role="dialog"] button[type="submit"]:not([disabled])'));
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.waitForFunction((s) => Number(document.querySelector("[data-seo-score]").getAttribute("data-seo-score")) > s, {}, start);

  const filled = await score();
  const left = await todo();
  // No cover, no author profile, no English version: 15 points short of 100.
  expect("filling the article raises the score to about 85", filled >= 80 && filled <= 88, `${filled}: ${left.join(", ")}`);
  expect("what is left to do: cover, author and translation", ["cover", "author", "translation"].every((c) => left.includes(c)) && left.length === 3, left.join(", "));
  expect("met checks (internal links, length, sections, keyword…) are done", !["internalLinks", "wordCount", "sections", "keywordInIntro", "keywordInHeading"].some((c) => left.includes(c)));
  await page.evaluate(() => document.querySelector("[data-seo-score]").scrollIntoView({ block: "start" }));
  await shot(page, "score-01-panel");

  // Removing the search phrase costs its checks at once.
  const keywordInput = await page.evaluateHandle(() => [...document.querySelectorAll("aside label")].find((l) => l.textContent.trim().startsWith("Từ khoá chính"))?.querySelector("input"));
  await keywordInput.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.waitForFunction((s) => Number(document.querySelector("[data-seo-score]").getAttribute("data-seo-score")) < s, {}, filled);
  expect("clearing the search phrase lowers the score live", (await todo()).includes("keywordSet"));
  await page.keyboard.type("phần mềm EMR");

  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector("header").innerText.includes("Đã lưu") && !document.querySelector("header").innerText.includes("Chưa lưu"), { timeout: 20000 });

  // The list shows the score next to the status.
  await page.goto(`${CMS}/admin?q=${encodeURIComponent("cach chon phan mem emr")}`, { waitUntil: "networkidle0" });
  const listed = await page.$eval("tbody", (b) => b.innerText);
  expect("the article list shows the SEO score", listed.includes(`SEO ${filled}`), listed.slice(0, 200));
  await shot(page, "score-02-list");
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "score-99-error").catch(() => {});
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
