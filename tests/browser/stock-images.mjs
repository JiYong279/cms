// Free stock photos in a real Chrome/Edge, against a stand-in Pexels:
//   node tests/stock/fake-pexels.mjs is started here; run the CMS with
//   PEXELS_API_KEY=fake PEXELS_API_URL=http://localhost:3998/v1, then: npm run test:stock-images
// A photo picked from the Insert menu, and one picked for an image suggestion, are copied into our own
// storage and credited to their photographer.
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, destroyPosts } from "../e2e/lib.mjs";
import { requests, startFakePexels } from "../stock/fake-pexels.mjs";

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

const fake = await startFakePexels();
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
// An article holding one image suggestion, as an AI draft would.
await admin.call(`/admin/posts/${postId}?locale=vi`, "savePost", [
  {
    postId, locale: "vi", status: "draft", title: "Bài thử ảnh miễn phí", slug: "", excerpt: "",
    contentHtml: '<p>Mở đầu.</p><div data-image-suggestion="" data-alt="Lễ tân đón khách tại quầy" data-caption="Quầy lễ tân">lễ tân phòng khám</div>',
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Mở đầu." }] }, { type: "imageSuggestion", attrs: { description: "lễ tân phòng khám", alt: "Lễ tân đón khách tại quầy", caption: "Quầy lễ tân" } }] },
    metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
  },
]);

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));
const dialog = "[data-stock-dialog]";

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-image-suggestion-view]");

  // From the suggestion: the picker opens already searching for what it should show.
  await page.click("[data-image-suggestion-view] button::-p-text(Tìm ảnh miễn phí)");
  await page.waitForSelector(`${dialog} [data-stock-results]`, { timeout: 15000 });
  const search = requests.find((r) => r.url.startsWith("/v1/search"));
  expect("it searches Pexels for the suggestion, in Vietnamese, with the key", !!search && new URL(search.url, "http://pexels").searchParams.get("query") === "lễ tân phòng khám" && search.url.includes("locale=vi-VN") && search.auth === "fake", search?.url);
  expect("three photos to choose from", (await page.$$(`${dialog} [data-stock-photo]`)).length === 3);
  await shot(page, "stock-01-picker");
  await page.click(`${dialog} [data-stock-photo="102"]`);
  await page.waitForFunction((d) => !document.querySelector(d), { timeout: 20000 }, dialog);
  const placed = await page.$eval(".ProseMirror img", (img) => ({ src: img.getAttribute("src"), alt: img.getAttribute("alt"), title: img.getAttribute("title"), rights: img.getAttribute("data-rights"), credit: img.getAttribute("data-credit") }));
  expect("the photo takes the suggestion's place with its description and caption", placed.alt === "Lễ tân đón khách tại quầy" && placed.title === "Quầy lễ tân", JSON.stringify(placed));
  expect("it is marked as a free stock photo, credited to its photographer", placed.rights === "stock" && placed.credit === "Nhiếp ảnh gia 102 / Pexels", JSON.stringify(placed));
  expect("it was copied into our own storage, not linked to Pexels", !!placed.src && !placed.src.includes("localhost:3998") && placed.src.endsWith(".webp"), placed.src);
  expect("the suggestion is gone", !(await page.$("[data-image-suggestion-view]")));

  // From the Insert menu, at the cursor.
  await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("end"));
  await page.click('button[title="Chèn"]');
  await sleep(150);
  await page.click("button::-p-text(Ảnh miễn phí)");
  await page.waitForSelector(dialog, { visible: true });
  await page.type(`${dialog} input`, "spa");
  await page.click(`${dialog} button[type="submit"]`);
  await page.waitForSelector(`${dialog} [data-stock-photo="101"]`, { timeout: 15000 });
  await page.click(`${dialog} [data-stock-photo="101"]`);
  await page.waitForFunction((d) => !document.querySelector(d), { timeout: 20000 }, dialog);
  const inserted = await page.$$eval(".ProseMirror img", (imgs) => imgs.map((i) => ({ alt: i.getAttribute("alt"), credit: i.getAttribute("data-credit") })));
  expect("a photo from the Insert menu keeps Pexels' description and credit", inserted.some((i) => i.alt === "Clinic receptionist 101" && i.credit === "Nhiếp ảnh gia 101 / Pexels"), JSON.stringify(inserted));
  await shot(page, "stock-02-inserted");
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "stock-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  fake.close();
  await destroyPosts(admin, postId ? [postId] : []);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
