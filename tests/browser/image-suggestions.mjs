// Image suggestions in a real Chrome/Edge: an AI draft pasted back holds suggestion blocks; uploading an
// image into one keeps its description and caption; a suggestion left over is flagged when publishing
// and never reaches the website.  npm run test:image-suggestions
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
const photo = `${OUT}suggestion-photo.png`;
await sharp({ create: { width: 900, height: 450, channels: 3, background: "#0a6b45" } }).png().toFile(photo);

const ANSWER = [
  "---",
  "title: Quầy lễ tân phòng khám chuyên nghiệp",
  "excerpt: Năm điều giúp quầy lễ tân đón khách tốt hơn.",
  "---",
  "",
  "## Đón khách",
  "",
  "Lễ tân là người đầu tiên khách gặp.",
  "",
  "> [!IMAGE] Lễ tân mỉm cười đón khách tại quầy | Lễ tân phòng khám đón khách tại quầy | Quầy lễ tân tại phòng khám",
  "",
  "## Sắp lịch",
  "",
  "Lịch hẹn rõ ràng giúp khách không phải chờ.",
  "",
  "> [!IMAGE] Màn hình lịch hẹn trên phần mềm Qub-X | Lịch hẹn trong ngày trên Qub-X | Lịch hẹn trên Qub-X",
].join("\n");

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));
const views = "[data-image-suggestion-view]";

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");

  // Paste an AI draft that suggests two pictures.
  await page.click("header button::-p-text(AI)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  if ((await page.$eval('[role="dialog"] [role="radio"][aria-checked="true"]:not([data-direction])', (b) => b.textContent)) !== "Claude của bạn") {
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
  await page.waitForSelector(views, { timeout: 10000 });
  expect("the draft shows its two image suggestions", (await page.$$(views)).length === 2);
  expect("each suggestion says what to show, its description and caption", await page.$eval(views, (v) => v.innerText.includes("Lễ tân mỉm cười đón khách") && v.innerText.includes("Lễ tân phòng khám đón khách tại quầy") && v.innerText.includes("Quầy lễ tân tại phòng khám")));
  await page.$eval(views, (v) => v.scrollIntoView({ block: "center" }));
  await shot(page, "suggest-01-block");

  // Upload a picture into the first one.
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click(`${views} button::-p-text(Tải ảnh lên)`)]);
  await chooser.accept([photo]);
  await page.waitForSelector('.ProseMirror img[alt="Lễ tân phòng khám đón khách tại quầy"]', { timeout: 20000 });
  const image = await page.$eval('.ProseMirror img[alt="Lễ tân phòng khám đón khách tại quầy"]', (img) => ({ title: img.getAttribute("title"), rights: img.getAttribute("data-rights") }));
  expect("the uploaded picture takes the suggestion's place, with its description and caption", image.title === "Quầy lễ tân tại phòng khám" && image.rights === "own", JSON.stringify(image));
  expect("one suggestion is left", (await page.$$(views)).length === 1);

  // Publishing: the leftover suggestion is flagged but does not block.
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector("header").innerText.includes("Đã lưu") && !document.querySelector("header").innerText.includes("Chưa lưu"), { timeout: 20000 });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(views);
  expect("a saved suggestion comes back when the article is reopened", (await page.$$(views)).length === 1);
  await page.click("header button::-p-text(Đăng bài)");
  await page.waitForSelector("[data-suggestions-left]", { visible: true });
  expect("the publish dialog says a suggestion is left", (await page.$eval("[data-suggestions-left]", (e) => e.innerText)).includes("Còn 1 gợi ý ảnh"));
  await shot(page, "suggest-02-publish");
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.innerText.includes("Đã đăng bài lên"), { timeout: 20000 });

  await sleep(2000);
  const qubx = await browser.newPage();
  await qubx.goto(`${QUBX}/vi/blog/quay-le-tan-phong-kham-chuyen-nghiep`, { waitUntil: "networkidle2" });
  const text = await qubx.$eval("main", (m) => m.innerText);
  expect("the website has the real picture", !!(await qubx.$('img[alt="Lễ tân phòng khám đón khách tại quầy"]')));
  expect("and never the leftover suggestion", !text.includes("Màn hình lịch hẹn trên phần mềm Qub-X"));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "suggest-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  fs.rmSync(photo, { force: true });
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
