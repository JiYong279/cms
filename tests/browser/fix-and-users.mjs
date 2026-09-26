// In a real Chrome/Edge: the SEO score's "fix it" buttons and header badge take you to the field,
// the publication date can be changed, and an admin can disable an account and enable it again.
// npm run test:fix-and-users
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, WRITER, destroyPosts, signedIn } from "../e2e/lib.mjs";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("dialog", (d) => d.accept());
let postId;

const inView = (selector) =>
  page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
const writerRow = () => page.$$eval("tbody tr", (rows, email) => rows.some((r) => r.innerText.includes(email)), WRITER.email);

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);

  // --- The SEO score of an empty article ---
  await page.goto(`${CMS}/admin?site=qubx`, { waitUntil: "networkidle0" });
  await page.click("button::-p-text(Viết bài mới)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  await page.click('[role="dialog"] input[value="qubx"]');
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button::-p-text(Tạo bài cho Qub-X)")]);
  postId = page.url().match(/posts\/([0-9a-f-]{36})/)?.[1];
  await page.waitForSelector("[data-seo-score]");

  expect("only the top 3 to-dos show at first", (await page.$$("[data-check]")).length === 3);
  await page.click("button::-p-text(Xem tất cả)");
  const todo = await page.$$eval("[data-check]", (els) => els.map((el) => el.getAttribute("data-check")));
  expect("'show all' lists every to-do", todo.length > 3, String(todo.length));
  expect("an empty article does not pass 'every image has a description'", todo.includes("imagesAlt"), todo.join(", "));
  expect("an empty article has nothing under 'done'", !(await page.$eval("#seo-score", (s) => s.innerText.includes("Đã đạt"))));

  // "Fix it" on the search phrase focuses its box in the side panel.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('[data-check="keywordSet"] button');
  await page.waitForFunction(() => document.activeElement?.id === "field-keyword", { timeout: 5000 });
  await sleep(700);
  expect("'fix it' focuses the search phrase box and brings it into view", await inView("#field-keyword"));

  // The score badge in the header takes you to the score.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click("[data-seo-badge]");
  await sleep(900);
  expect("the header score badge scrolls to the SEO score", await inView("#seo-score"));
  await shot(page, "fix-01-score");

  // --- Changing the publication date ---
  await page.$eval("#field-published-at", (el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "2025-01-15T09:30");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type("#field-title", "Bài thử đổi ngày đăng");
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector("header").innerText.includes("Đã lưu") && !document.querySelector("header").innerText.includes("Chưa lưu"), { timeout: 20000 });
  await page.reload({ waitUntil: "networkidle0" });
  const date = await page.$eval("#field-published-at", (el) => el.value);
  expect("a changed publication date is saved", date === "2025-01-15T09:30", date);
  const dateLabel = await page.$eval("#field-published-at", (el) => el.closest("label")?.firstElementChild?.textContent ?? "");
  expect("the publication date label is just its name, its explanation sits apart", dateLabel === "Ngày đăng", dateLabel);

  // --- Disabling an account ---
  await page.goto(`${CMS}/admin/users`, { waitUntil: "networkidle0" });
  expect("the users page has Active and Disabled tabs", await page.$eval("nav[aria-label='Lọc theo trạng thái']", (n) => n.innerText.includes("Đang hoạt động") && n.innerText.includes("Đã vô hiệu hoá")));
  expect("your own row has no disable button", !(await page.$$eval("tbody tr", (rows, email) => rows.find((r) => r.innerText.includes(email))?.querySelector("button"), ADMIN.email)));
  const disableButton = await page.evaluateHandle((email) => [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(email))?.querySelector("button"), WRITER.email);
  await disableButton.click();
  await page.waitForSelector('[role="alertdialog"]', { visible: true });
  expect("disabling asks for confirmation first", (await page.$eval('[role="alertdialog"]', (d) => d.innerText)).includes("Vô hiệu hoá tài khoản"));
  await shot(page, "fix-02-disable-confirm");
  await page.click('[role="alertdialog"] button::-p-text(Vô hiệu hoá)');
  await page.waitForFunction((email) => ![...document.querySelectorAll("tbody tr")].some((r) => r.innerText.includes(email)), { timeout: 15000 }, WRITER.email);
  expect("a disabled account leaves the Active tab", !(await writerRow()));

  const writer = new Client();
  const login = await writer.login(WRITER.email, WRITER.password);
  expect("a disabled account cannot sign in", !signedIn(login), login.location);

  await page.goto(`${CMS}/admin/users?view=disabled`, { waitUntil: "networkidle0" });
  expect("it is listed under Disabled", await writerRow());
  await shot(page, "fix-03-disabled-tab");
  const enableButton = await page.evaluateHandle((email) => [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(email))?.querySelector("button"), WRITER.email);
  await enableButton.click();
  await page.waitForFunction((email) => ![...document.querySelectorAll("tbody tr")].some((r) => r.innerText.includes(email)), { timeout: 15000 }, WRITER.email);
  await page.goto(`${CMS}/admin/users`, { waitUntil: "networkidle0" });
  expect("enabling it again brings it back to Active", await writerRow());
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "fix-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  if (postId) await destroyPosts(admin, [postId]);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
