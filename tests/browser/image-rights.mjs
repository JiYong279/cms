// Image rights and credits in a real Chrome/Edge: an image linked from elsewhere starts as "unknown"
// (orange outline, a hint), an uploaded one as the team's own; publishing asks the editor to confirm
// the unknown ones; the website shows the credit under the image.  npm run test:image-rights
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { ADMIN, CMS, Client, QUBX, destroyPosts } from "../e2e/lib.mjs";

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

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
const LINKED = `${CMS}/icon.png`;
const CREDIT = "Bộ Y tế";
const photo = `${OUT}rights-photo.png`;
await sharp({ create: { width: 800, height: 400, channels: 3, background: "#20b56e" } }).png().toFile(photo);

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));
const pm = ".ProseMirror";

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector(pm);
  await page.type("#field-title", "Bài thử nguồn ảnh");
  await page.click(pm);
  await page.keyboard.type("Đoạn mở đầu của bài.");

  // An image uploaded from the computer is the team's own.
  const upload = await page.$('#field-content input[type="file"]');
  await upload.uploadFile(photo);
  await page.waitForSelector(`${pm} img[data-rights="own"]`, { timeout: 20000 });
  expect("an uploaded image is marked as our own", true);

  // An image linked from elsewhere: nobody knows yet whether it may be used.
  await page.evaluate((sel) => document.querySelector(sel).editor.commands.focus("end"), pm);
  await page.click('button[title="Chèn"]');
  await sleep(150);
  await page.click("button::-p-text(Ảnh từ đường dẫn)");
  await page.waitForSelector('input[placeholder^="https://"]');
  await page.type('input[placeholder^="https://"]', LINKED);
  await page.click('[role="dialog"] button[type="submit"], form button[type="submit"]');
  const linked = `${pm} img[src="${LINKED}"]`;
  await page.waitForSelector(linked, { timeout: 10000 });
  expect("an image linked from elsewhere starts as 'not sure we may use it'", (await page.$eval(linked, (img) => img.getAttribute("data-rights"))) === "unknown");
  expect("it stands out with an orange outline", (await page.$eval(linked, (img) => getComputedStyle(img).outlineColor)) === "rgb(245, 158, 11)", await page.$eval(linked, (img) => getComputedStyle(img).outlineColor));

  await page.click(linked);
  await page.waitForSelector("[data-image-rights]", { visible: true });
  expect("its box shows the rights and a hint", (await page.$eval("[data-image-rights]", (s) => s.value)) === "unknown" && (await page.evaluate(() => document.body.innerText.includes("Chưa rõ thì đừng dùng"))));
  await page.type('input[aria-label="Tác giả hoặc nơi lấy ảnh"]', CREDIT);
  await shot(page, "rights-01-bubble");

  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector("header").innerText.includes("Đã lưu") && !document.querySelector("header").innerText.includes("Chưa lưu"), { timeout: 20000 });

  // Publishing: the editor must confirm the unknown image first.
  await page.click("header button::-p-text(Đăng bài)");
  await page.waitForSelector("[data-unknown-images]", { visible: true });
  const submit = '[role="dialog"] button[type="submit"]';
  expect("the publish dialog names the unknown image and waits for a confirmation", (await page.$eval("[data-unknown-images]", (e) => e.innerText.includes("1 ảnh chưa rõ quyền"))) && (await page.$eval(submit, (b) => b.disabled)));
  await shot(page, "rights-02-publish");
  await page.click("[data-unknown-images] input[type=checkbox]");
  expect("confirming allows publishing", !(await page.$eval(submit, (b) => b.disabled)));
  await page.click(submit);
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.innerText.includes("Đã đăng bài lên"), { timeout: 20000 });
  expect("the editor now shows the image as allowed", (await page.$eval(linked, (img) => img.getAttribute("data-rights"))) === "permitted");
  expect("and nothing is left unsaved", !(await page.$eval("header", (h) => h.innerText.includes("Chưa lưu"))));

  // The website credits the image under it.
  await sleep(2000);
  const qubx = await browser.newPage();
  await qubx.goto(`${QUBX}/vi/blog/bai-thu-nguon-anh`, { waitUntil: "networkidle2" });
  const caption = await qubx.$$eval("figure figcaption", (fs) => fs.map((f) => f.textContent?.trim()));
  expect("the website shows the image's credit", caption.some((c) => c?.includes(`Nguồn ảnh: ${CREDIT}`)), JSON.stringify(caption));
  await qubx.evaluate(() => document.querySelector("figure figcaption")?.scrollIntoView({ block: "center" }));
  await shot(qubx, "rights-03-qubx");
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "rights-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  fs.rmSync(photo, { force: true });
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
