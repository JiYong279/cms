// The content overview in a real Chrome/Edge: writing the brief and the weekly target, the next steps
// following it, and planning a topic straight from the topic table.  npm run test:overview
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, readBrief, writeBrief } from "../e2e/lib.mjs";

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
const URL_ = `${CMS}/admin/overview?site=qubx`;
const FIELDS = ["audience", "goal", "offering", "voice", "avoid", "notes"];

// The brief as saved now, to put back afterwards.
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const before = await readBrief(admin, "qubx");

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));

try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);

  // Start from an empty brief, the way a new website does.
  await writeBrief(admin, { siteId: "qubx", brief: Object.fromEntries(FIELDS.map((f) => [f, ""])), postsPerWeek: null });
  await page.goto(URL_, { waitUntil: "networkidle0" });
  expect("with no brief, writing it is the first next step", (await page.$eval("[data-next-steps] li", (li) => li.dataset.step)) === "brief");
  expect("and asking for a weekly target comes next", !!(await page.$('[data-step="target"]')));

  // "Write the brief" in the next steps opens the brief's form, as a person would reach it.
  await page.click('[data-step="brief"] a');
  const opened = await page.waitForSelector('textarea[name="audience"]', { visible: true, timeout: 5000 }).catch(() => null);
  expect("'Write the brief' opens the form", !!opened);
  if (!opened) await page.click("[data-brief-edit]");
  await page.waitForSelector('textarea[name="audience"]', { visible: true });
  await page.type('textarea[name="audience"]', "Chủ phòng khám thử trình duyệt");
  await page.type('input[name="postsPerWeek"]', "4");
  await page.click("[data-brief-save]");
  await page.waitForFunction(() => document.querySelector("[data-brief] [role=status]")?.textContent?.includes("Đã lưu định hướng"), { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-step="brief"]'), { timeout: 10000 });
  const shown = await page.$eval("[data-brief]", (el) => el.textContent ?? "");
  expect("the saved brief and target show on the page", shown.includes("Chủ phòng khám thử trình duyệt") && shown.includes("4 bài/tuần"), shown.slice(0, 200));
  expect("the next steps no longer ask for them", !(await page.$('[data-step="brief"]')) && !(await page.$('[data-step="target"]')));
  const weeks = await page.$eval("[data-weeks]", (el) => el.textContent ?? "");
  expect("the weeks ahead are measured against the target", /\d+\/4 bài/.test(weeks), weeks.slice(0, 200));
  await page.screenshot({ path: `${OUT}overview.png`, fullPage: true });

  // Planning a topic from its row opens the plan with that topic.
  const row = await page.$("[data-topics] tr[data-topic] [data-plan-ai]");
  if (row) {
    const topic = await row.evaluate((b) => b.closest("tr")?.querySelector("th")?.firstChild?.textContent?.trim() ?? "");
    await row.click();
    await page.waitForSelector("[data-plan-dialog]", { visible: true });
    const value = await page.$eval("[data-plan-dialog] textarea", (t) => t.value);
    expect("planning from a topic starts with that topic", !!topic && value === topic, `${topic} / ${value}`);
    await page.screenshot({ path: `${OUT}overview-plan.png` });
    await page.keyboard.press("Escape");
  } else {
    expect("a topic that needs articles offers to plan them", false);
  }
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await page.screenshot({ path: `${OUT}overview-error.png` }).catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await writeBrief(admin, before);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
