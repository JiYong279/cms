// In a real Chrome/Edge: a cover image goes to the S3 storage configured for the CMS (locally the Silo/MinIO
// of docker-compose.minio.yml), shows in the editor, and shows on Qub-X once the article is published.
//   E2E_QUBX_URL=http://localhost:3002 npm run test:image-storage
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { ADMIN, CMS, Client, QUBX, destroyPosts } from "../e2e/lib.mjs";

const STORAGE = (process.env.E2E_STORAGE_URL ?? "http://localhost:9000/cms").replace(/\/$/, "");
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

const coverFile = `${OUT}storage-cover.png`;
await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#0a6b45" } })
  .composite([{ input: Buffer.from('<svg width="1600" height="800"><circle cx="800" cy="400" r="240" fill="#20b56e"/></svg>') }])
  .png()
  .toFile(coverFile);

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("dialog", (d) => d.accept());
let postId;
const loaded = (p, selector) => p.$eval(selector, (img) => img.complete && img.naturalWidth > 0).catch(() => false);

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

  await page.type("#field-title", "Thử kho ảnh Silo");
  const input = await page.$('#field-cover input[type="file"]');
  await input.uploadFile(coverFile);
  await page.waitForSelector(`#field-cover img[src^="${STORAGE}/"]`, { timeout: 20000 });
  const src = await page.$eval("#field-cover img", (img) => img.getAttribute("src"));
  expect("the cover is stored in the S3 storage", src.startsWith(`${STORAGE}/`) && src.endsWith(".webp"), src);
  await page.waitForFunction(() => document.querySelector("#field-cover img")?.complete, { timeout: 10000 });
  expect("the editor shows the cover from the storage", await loaded(page, "#field-cover img"));
  const stored = await fetch(src);
  expect("anyone can open the image address", stored.ok && stored.headers.get("content-type") === "image/webp", `${stored.status}`);
  await shot(page, "storage-01-editor");

  await page.click("header button::-p-text(Đăng bài)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.innerText.includes("Đã đăng bài lên"), { timeout: 20000 });

  await sleep(2000);
  const qubx = await browser.newPage();
  await qubx.setViewport({ width: 1280, height: 900 });
  const res = await qubx.goto(`${QUBX}/vi/blog/thu-kho-anh-silo`, { waitUntil: "networkidle2" });
  const selector = `img[src="${src}"]`;
  expect("Qub-X shows the article", res.status() === 200, String(res.status()));
  expect("Qub-X shows the cover from the storage", await loaded(qubx, selector));
  await shot(qubx, "storage-02-qubx");
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "storage-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  if (postId) {
    const admin = new Client();
    await admin.login(ADMIN.email, ADMIN.password);
    await destroyPosts(admin, [postId]);
  }
  fs.rmSync(coverFile, { force: true });
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
