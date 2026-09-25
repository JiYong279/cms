// Manages categories in a real Chrome/Edge: add, edit, reorder and delete one, and checks the
// public API the websites read. Run with the CMS dev server up: npm run test:browser
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, WRITER } from "../e2e/lib.mjs";

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
const api = async (locale) =>
  (await (await fetch(`${CMS}/api/public/v1/sites/qubx/categories?locale=${locale}`)).json()).categories;

// Not a word of the interface, so the English-interface test never mistakes it for one.
const NAME_VI = "Góc kiến thức thử";
const NAME_EN = "Test category";
const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

/** Deletes test categories left behind by an earlier run that stopped half-way. */
async function removeLeftovers() {
  const leftover = (await api("vi")).filter((c) => c.name === NAME_VI);
  if (!leftover.length) return;
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  await admin.req("/admin/categories");
  for (const c of leftover) await admin.call("/admin/categories", "deleteCategory", [c.id]);
}

// The Qub-X section of the page, and the row of the test category in it.
const section = () => page.evaluateHandle(() => [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent === "Qub-X"));
const rowSelector = (name) => `::-p-xpath(//tr[.//p[normalize-space()="${name}"]])`;

try {
  await removeLeftovers();
  const writer = new Client();
  await writer.login(WRITER.email, WRITER.password);
  expect("writers cannot manage categories", (await writer.req("/admin/categories")).text.includes("Chỉ biên tập viên và quản trị viên quản lý được danh mục."));

  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);

  await page.goto(`${CMS}/admin/categories`, { waitUntil: "networkidle0" });
  expect("the menu opens the categories page", !!(await page.$('nav a[href="/admin/categories"]')));
  const before = await api("vi");

  // Add
  await (await section()).asElement().$("button::-p-text(Thêm danh mục)").then((b) => b.click());
  await page.waitForSelector('input[name="nameVi"]', { visible: true });
  await page.type('input[name="nameVi"]', NAME_VI);
  await page.type('input[name="nameEn"]', NAME_EN);
  await shot(page, "cat-01-add");
  await page.click('section form button[type="submit"]');
  await page.waitForSelector(rowSelector(NAME_VI), { timeout: 20000 });
  let listed = (await api("vi")).find((c) => c.name === NAME_VI);
  expect("a new category is listed last with slugs built from its names", !!listed && listed.slug === "goc-kien-thuc-thu" && listed.alternates.en === "test-category" && (await api("vi")).at(-1).name === NAME_VI, JSON.stringify(listed));
  expect("the English API uses the English name", (await api("en")).some((c) => c.name === NAME_EN && c.slug === "test-category"));

  // A second category with the same address is refused.
  await (await section()).asElement().$("button::-p-text(Thêm danh mục)").then((b) => b.click());
  await page.waitForSelector('input[name="nameVi"]', { visible: true });
  await page.type('input[name="nameVi"]', NAME_VI);
  await page.type('input[name="nameEn"]', "Another one");
  await page.click('section form button[type="submit"]');
  await page.waitForFunction(() => document.body.innerText.includes("đã được danh mục khác dùng"), { timeout: 20000 });
  expect("a duplicate address is refused", true);
  await (await section()).asElement().$("button::-p-text(Đóng)").then((b) => b.click());

  // Edit
  await (await page.waitForSelector(rowSelector(NAME_VI))).$('button[aria-label="Sửa"]').then((b) => b.click());
  await page.waitForSelector('textarea[name="descriptionVi"]', { visible: true });
  await page.type('textarea[name="descriptionVi"]', "Giới thiệu thử.");
  await page.click('section form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('textarea[name="descriptionVi"]'), { timeout: 20000 });
  listed = (await api("vi")).find((c) => c.name === NAME_VI);
  expect("editing saves the introduction", listed?.description === "Giới thiệu thử.", JSON.stringify(listed));

  // Reorder: move it up one place.
  await (await page.$(rowSelector(NAME_VI))).$('button[aria-label="Đưa lên"]').then((b) => b.click());
  await page.waitForFunction(
    (name) => {
      const rows = [...document.querySelectorAll("section tbody tr")].map((r) => r.querySelector("p")?.textContent);
      return rows.includes(name) && rows.at(-1) !== name;
    },
    { timeout: 20000 },
    NAME_VI,
  );
  const order = (await api("vi")).map((c) => c.name);
  expect("moving up changes the order on the website", order.at(-2) === NAME_VI, order.join(" | "));
  await shot(page, "cat-02-list");

  // Delete, after confirming.
  await (await page.$(rowSelector(NAME_VI))).$('button[aria-label="Xoá danh mục"]').then((b) => b.click());
  await page.waitForSelector('[role="alertdialog"]', { visible: true });
  expect("deleting asks first", await page.$eval('[role="alertdialog"]', (d, name) => d.innerText.includes(`Xoá danh mục “${name}”?`), NAME_VI));
  await shot(page, "cat-03-delete");
  await page.click('[role="alertdialog"] button::-p-text(Xoá danh mục)');
  await page.waitForFunction((name) => ![...document.querySelectorAll("section tbody p")].some((p) => p.textContent === name), { timeout: 20000 }, NAME_VI);
  const after = await api("vi");
  expect("the category is gone and the others keep their order", after.map((c) => c.id).join() === before.map((c) => c.id).join(), after.map((c) => c.name).join(" | "));

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  const activity = (await admin.req("/admin/activity?type=site")).text;
  expect("the activity log records adding and deleting it", activity.includes(`Thêm danh mục ${NAME_VI}`) && activity.includes(`Xoá danh mục ${NAME_VI}`));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "cat-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  // Leave nothing behind if the test stopped half-way.
  await removeLeftovers();
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
