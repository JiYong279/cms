// Drives the real editor in a local Chrome/Edge: toolbar, "/" menu, blocks, save, publish,
// and checks Qub-X renders every block. Screenshots land in tests/browser/screenshots.
//   npm run test:browser      (CMS and Qub-X dev servers running; CHROME_PATH to override the browser)
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, QUBX, destroyPosts } from "../e2e/lib.mjs";

const OUT = new URL("./screenshots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.mkdirSync(OUT, { recursive: true });
const BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const executablePath = BROWSERS.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error("No Chrome/Edge found; set CHROME_PATH");
let failures = 0;
const expect = (label, ok) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts });
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("dialog", (d) => d.accept());

try {
  // Sign in
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  log("after login:", page.url());

  // New article for Qub-X
  await page.goto(`${CMS}/admin?site=qubx`, { waitUntil: "networkidle0" });
  // "Viết bài mới" asks which website first.
  await page.click('button::-p-text(Viết bài mới)');
  await page.waitForSelector('[role="dialog"]', { visible: true });
  await shot(page, "00-choose-site");
  await page.click('[role="dialog"] input[value="qubx"]');
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button::-p-text(Tạo bài cho Qub-X)')]);
  log("editor:", page.url());
  await page.waitForSelector(".ProseMirror");
  await page.waitForSelector('[role="toolbar"]');
  await shot(page, "01-empty-editor");

  await page.click('textarea[placeholder="Tiêu đề bài viết"]');
  await page.keyboard.type("Thử trình soạn thảo mới");
  await page.click('textarea[placeholder^="Đoạn tóm tắt"]');
  await page.keyboard.type("Bài thử các khối mới: bảng, khung ghi chú, video.");

  const pm = ".ProseMirror";
  await page.click(pm);
  await page.keyboard.type("## Phần một");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Đoạn mở đầu có chữ tô màu.");
  await page.keyboard.press("Enter");

  // "/" menu → table
  await page.keyboard.type("/");
  await page.waitForSelector('[role="listbox"]');
  await shot(page, "02-slash-menu");
  await page.keyboard.type("bang");
  await sleep(200);
  await page.keyboard.press("Enter");
  await page.waitForSelector(`${pm} table`);
  await page.keyboard.type("Tiêu chí");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Trước");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Sau");
  await shot(page, "03-table-bubble");

  // Continue after the table
  await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("end"));
  await page.keyboard.type("/luu y");
  await sleep(200);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Đây là khung lưu ý.");
  // The toolbar's box button changes the kind of the box the cursor is in, and back.
  const variant = () => page.$eval(".ProseMirror [data-callout]", (el) => el.getAttribute("data-variant"));
  const pickBox = async (label) => {
    await page.click('[role="toolbar"] button[title="Khung nổi bật"]');
    await page.click(`button::-p-text(${label})`);
  };
  await pickBox("Khung điểm chính");
  expect("the toolbar box button changes the box kind", (await variant()) === "success", await variant());
  await pickBox("Khung lưu ý");
  expect("and changes it back", (await variant()) === "warning", await variant());
  await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("end"));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  // Toolbar: Insert → YouTube
  const clickByText = async (selector, text) => {
    const handles = await page.$$(selector);
    for (const h of handles) {
      const t = await h.evaluate((el) => el.textContent?.trim());
      if (t === text) return h.click();
    }
    throw new Error(`No ${selector} with text ${text}`);
  };
  await page.click('button[title="Chèn"]');
  await sleep(150);
  await shot(page, "04-insert-menu");
  await clickByText("button", "Video YouTube");
  await page.waitForSelector('input[placeholder^="https://www.youtube.com"]');
  await page.type('input[placeholder^="https://www.youtube.com"]', "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await clickByText('button[type="submit"]', "Chèn");
  await page.waitForSelector(`${pm} div[data-youtube-video] iframe`);

  // Colour a word from the toolbar
  await page.evaluate(() => {
    const ed = document.querySelector(".ProseMirror").editor;
    let from = null;
    ed.state.doc.descendants((node, pos) => {
      if (from === null && node.isText && node.text.includes("tô màu")) from = pos + node.text.indexOf("tô màu");
    });
    ed.chain().focus().setTextSelection({ from, to: from + "tô màu".length }).run();
  });
  await page.click('button[title="Màu chữ và tô nền"]');
  await sleep(150);
  await shot(page, "05-color-menu");
  await page.click('button[aria-label="Xanh Qub-X"]');

  // Save (Ctrl+S) as a draft, then publish from the header button
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.body.innerText.includes("Đã lưu"), { timeout: 20000 });
  expect("a saved draft stays a draft", (await page.$eval("#field-status", (s) => s.value)) === "draft");
  await page.click("header button::-p-text(Đăng bài)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  expect("publish dialog names the website", await page.$eval('[role="dialog"]', (d) => d.innerText.includes("Đăng bài lên Qub-X")));
  await shot(page, "06-publish-dialog");
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.innerText.includes("Đã đăng bài lên"), { timeout: 20000 });
  expect("publishing sets the status to published", (await page.$eval("#field-status", (s) => s.value)) === "published");
  await page.waitForSelector("header button::-p-text(Cập nhật)", { timeout: 10000 });
  expect("once live, the header offers Update instead of Publish", !(await page.$("header button::-p-text(Đăng bài)")));
  await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
  await shot(page, "06-editor-full");

  const json = await page.evaluate(() => document.querySelector(".ProseMirror").editor.getJSON());
  log("node types:", [...new Set(JSON.stringify(json).match(/"type":"[a-zA-Z]+"/g))].join(" "));

  // Qub-X renders it
  await sleep(3000);
  const qubx = await browser.newPage();
  await qubx.setViewport({ width: 1280, height: 900 });
  const res = await qubx.goto(`${QUBX}/vi/blog/thu-trinh-soan-thao-moi`, { waitUntil: "networkidle2" });
  log("qubx status:", res.status());
  const found = await qubx.evaluate(() => ({
    table: !!document.querySelector("article table"),
    callout: !!document.querySelector("article aside.rounded-2xl"),
    youtube: !!document.querySelector('article iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]'),
    colored: !!document.querySelector('article span[style*="color"]'),
    toc: document.querySelector('nav[aria-label="Trong bài viết"]')?.innerText,
  }));
  expect("editor keeps heading, colour, table, callout and video", ["\"level\":2", "\"color\":\"#0a6b45\"", "\"type\":\"table\"", "\"type\":\"callout\"", "\"src\":\"https://www.youtube.com"].every((s) => JSON.stringify(json).includes(s)));
  expect("Qub-X shows the section in its table of contents", /Phần một/.test(found.toc ?? ""));
  expect("Qub-X renders the table", found.table);
  expect("Qub-X renders the callout", found.callout);
  expect("Qub-X renders the YouTube video", found.youtube);
  expect("Qub-X renders the coloured text", found.colored);
  await qubx.evaluate(() => document.querySelector("article table")?.scrollIntoView({ block: "center" }));
  await shot(qubx, "08-qubx-blocks");
  await qubx.evaluate(() => document.querySelector("article section")?.scrollIntoView());
  await shot(qubx, "07-qubx-article", { fullPage: false });

  // The trash button in the list asks first, in a small box next to it.
  // Back to the CMS tab: Chrome pauses rendering in background tabs, which stalls clicks.
  await qubx.close();
  await page.bringToFront();
  await page.goto(`${CMS}/admin?q=${encodeURIComponent("thu trinh soan thao moi")}`, { waitUntil: "networkidle0" });
  const trashButton = 'tbody tr button[aria-label="Chuyển vào thùng rác"]';
  await page.click(trashButton);
  await page.waitForSelector('[role="alertdialog"]', { visible: true });
  expect("the trash button asks for confirmation", await page.$eval('[role="alertdialog"]', (d) => d.innerText.includes("Chuyển bài này vào thùng rác?")));
  await shot(page, "09-confirm-trash");
  await page.click('[role="alertdialog"] button::-p-text(Huỷ)');
  expect("cancelling keeps the article", !(await page.$('[role="alertdialog"]')) && !!(await page.$(trashButton)));
  await page.click(trashButton);
  await page.waitForSelector('[role="alertdialog"]', { visible: true });
  await page.click('[role="alertdialog"] button::-p-text(Chuyển vào thùng rác)');
  await page.waitForFunction(() => document.body.innerText.includes("Đã chuyển 1 bài vào thùng rác"), { timeout: 20000 });
  expect("confirming moves it to the trash", true);

} catch (error) {
  failures++;
  log("ERROR:", error.message);
  await shot(page, "99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0);
  if (errors.length) log(`  ${errors.slice(0, 10).join("\n  ")}`);
  await browser.close();
  // Remove the test article(s).
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  // Look in the trash too: the test itself moves the article there.
  const list = (await admin.req("/admin?q=thu%20trinh%20soan%20thao")).text + (await admin.req("/admin?view=trash&q=thu%20trinh%20soan%20thao")).text;
  await destroyPosts(admin, [...new Set([...list.matchAll(/\/admin\/posts\/([0-9a-f-]{36})\?locale=vi/g)].map((m) => m[1]))]);
}
process.exit(failures ? 1 : 0);
