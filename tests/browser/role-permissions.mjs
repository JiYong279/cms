// In a real Chrome/Edge: an admin ticks what writers may do on the users page, saves it, finds it
// still there after a reload, and puts the defaults back. Writes screenshots for the pull request.
// npm run test:roles
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { EDITABLE_PERMISSIONS, isGrantedByDefault } from "../../src/lib/permissions.ts";
import { ADMIN, CMS, Client } from "../e2e/lib.mjs";

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

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const BOX = 'input[data-role="writer"][data-permission="activity.view"]';
const matrix = () => page.$("section:has(> h2) table:has(input[data-permission])");
const shot = async (name) => {
  const table = await page.$("input[data-permission]");
  await table?.evaluate((el) => el.closest("section")?.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${OUT}${name}.png` });
};
const isChecked = () => page.$eval(BOX, (el) => el.checked);
const isMarked = () => page.$eval(BOX, (el) => el.closest("td")?.classList.contains("bg-amber-100") ?? false);
const saveButton = "button::-p-text(Lưu phân quyền)";
const saveDisabled = () => page.$eval(saveButton, (el) => el.disabled);
const save = async () => {
  await page.click(saveButton);
  await page.waitForSelector('[role="status"]::-p-text(Đã lưu)', { visible: true, timeout: 20000 });
};

try {
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);

  await page.goto(`${CMS}/admin/users`, { waitUntil: "networkidle0" });
  expect("the permissions table has checkboxes", !!(await matrix()));
  expect("writers cannot see the activity log by default", !(await isChecked()));
  expect("nothing to save yet", await saveDisabled());
  const adminOnlyBoxes = await page.$$('input[data-permission="users.manage"], input[data-permission="sites.manage"]');
  expect("managing users and websites has no checkbox (admins only)", adminOnlyBoxes.length === 0);
  await shot("roles-01-defaults");

  await page.click(BOX);
  expect("a ticked box is marked as changed from the default", await isMarked());
  expect("unsaved changes are announced", (await page.$eval("body", (b) => b.innerText)).includes("Có thay đổi chưa lưu"));
  await shot("roles-02-changed");
  await save();
  await page.reload({ waitUntil: "networkidle0" });
  expect("the change is kept after a reload", (await isChecked()) && (await isMarked()));
  await shot("roles-03-saved");

  // The change applies to writers at once (the server checks it on every request).
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  const activity = await admin.req("/admin/activity");
  expect("the change is in the activity log", activity.text.includes("Đổi quyền của vai trò Người viết"));

  await page.click("button::-p-text(Về mặc định)");
  expect("“back to defaults” unticks it", !(await isChecked()));
  await save();
  await page.reload({ waitUntil: "networkidle0" });
  expect("the defaults are back after a reload", !(await isChecked()) && !(await isMarked()));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await page.screenshot({ path: `${OUT}roles-99-error.png` }).catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  // Whatever happened above, leave the permissions at their defaults.
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  await admin.req("/admin/users");
  const defaults = Object.fromEntries(["editor", "writer"].map((role) => [role, EDITABLE_PERMISSIONS.filter((p) => isGrantedByDefault(role, p))]));
  await admin.call("/admin/users", "saveRolePermissions", [defaults]);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
