// Drives the editor's AI assistant in a real Chrome/Edge against a fake Anthropic API:
// draft a Vietnamese article, save it, translate it into English, and check the result.
//   node tests/ai/fake-anthropic.mjs is started here; run the CMS with
//   ANTHROPIC_API_KEY=fake ANTHROPIC_BASE_URL=http://localhost:3999, then: npm run test:ai
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, destroyPosts } from "../e2e/lib.mjs";
import { requests, startFakeAnthropic } from "../ai/fake-anthropic.mjs";

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

const fake = await startFakeAnthropic();
const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("dialog", (d) => d.accept());
let postId;

const editorState = () =>
  page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    return {
      title: document.querySelector('main textarea')?.value,
      h2: [...pm.querySelectorAll("h2")].map((h) => h.textContent),
      table: !!pm.querySelector("table"),
      callout: pm.querySelector("[data-callout]")?.getAttribute("data-variant"),
      orderedItems: pm.querySelectorAll("ol li").length,
      html: pm.innerHTML,
    };
  });

async function runAi(submitText) {
  await page.click("header button::-p-text(AI)");
  await page.waitForSelector('[role="dialog"]', { visible: true });
  return async () => {
    await page.click(`[role="dialog"] button[type="submit"]::-p-text(${submitText})`);
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.innerText.includes("AI đã viết xong"), { timeout: 60000 });
  };
}

async function saveNow() {
  const before = await page.$eval("header", (h) => h.innerText);
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction((b) => {
    const text = document.querySelector("header").innerText;
    return text.includes("Đã lưu") && !text.includes("Chưa lưu") && text !== b;
  }, { timeout: 20000 }, before);
}

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

  // 1. Draft the Vietnamese version
  const submitDraft = await runAi("Viết bản nháp");
  expect("a new article opens the AI dialog on 'Write a draft'", await page.$eval('[role="dialog"]', (d) => d.querySelector('input[name="aiMode"]:checked')?.closest("label")?.innerText.includes("Viết bản nháp")));
  expect("translating is unavailable while the other version does not exist", await page.$eval('[role="dialog"]', (d) => [...d.querySelectorAll('input[name="aiMode"]')][1].disabled));
  const [topicBox, pointsBox] = await page.$$('[role="dialog"] textarea');
  await topicBox.type("phần mềm EMR");
  await pointsBox.type("Chi phí\nCách chọn");
  await shot(page, "ai-01-draft-dialog");
  await submitDraft();
  let state = await editorState();
  expect("the draft fills the title", state.title === "Bản nháp AI: phần mềm EMR", state.title);
  expect("the draft fills the body with sections, list, table and callout", state.h2.join("|") === "Mở đầu|Các bước" && state.table && state.callout === "success" && state.orderedItems === 2, JSON.stringify({ ...state, html: undefined }));
  expect("markup the editor does not support is dropped", !/script|onclick|style="color/.test(state.html));
  const draftRequest = requests.at(-1);
  expect("the prompt carries the topic, key points and language", /Topic: phần mềm EMR/.test(draftRequest.messages[0].content) && /Chi phí/.test(draftRequest.messages[0].content) && /Write in Vietnamese/.test(draftRequest.system));
  expect("the built-in AI must link its sources, official first, and never invent links", ["Sources (required)", "moh.gov.vn", "leave the fact out"].every((s) => draftRequest.system.includes(s)));
  expect("the model must answer through the article tool", draftRequest.tool_choice?.name === "article" && draftRequest.stream === true);
  const offered = draftRequest.tools[0].input_schema.properties.category?.enum ?? [];
  const picked = await page.$$eval("aside select", (selects) => {
    const s = selects.find((x) => [...x.options].some((o) => o.text === "Chưa phân loại"));
    return s?.options[s.selectedIndex]?.text;
  });
  expect("the AI picks one of the existing categories", offered.length > 0 && picked === offered.at(-1), `${picked} / ${offered.join(", ")}`);
  expect("nothing is saved until the user saves", (await page.$eval("header", (h) => h.innerText)).includes("Chưa lưu"));
  await shot(page, "ai-02-draft-result");
  await saveNow();
  expect("the slug follows the AI title", (await page.$$eval("aside input", (inputs) => inputs.map((i) => i.value))).includes("ban-nhap-ai-phan-mem-emr"));

  // 2. Translate into English
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('nav[aria-label="Ngôn ngữ"] a[href$="locale=en"]')]);
  await page.waitForSelector(".ProseMirror");
  const submitTranslate = await runAi("Dịch từ bản Tiếng Việt");
  expect(
    "an empty English version opens the dialog on translating from Vietnamese",
    await page.$eval('[role="dialog"]', (d) => d.querySelector('input[name="aiMode"]:checked')?.closest("label")?.innerText.includes("Dịch bài") && d.querySelector('[data-direction="into"]')?.getAttribute("aria-checked") === "true"),
  );
  await shot(page, "ai-03-translate-dialog");
  await submitTranslate();
  state = await editorState();
  expect("the translation fills the title", state.title === "[EN] Bản nháp AI: phần mềm EMR", state.title);
  expect("the translation keeps sections, table and callout", state.h2.join("|") === "[EN] Mở đầu|[EN] Các bước" && state.table && state.callout === "success", JSON.stringify({ ...state, html: undefined }));
  const translateRequest = requests.at(-1);
  expect("the translation request sends the saved Vietnamese article", /Title: Bản nháp AI: phần mềm EMR/.test(translateRequest.messages[0].content) && /into English/.test(translateRequest.system));
  await shot(page, "ai-04-translate-result");
  await saveNow();

  // 3. The English version remembers its source: editing the Vietnamese one marks it stale.
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  await page.reload({ waitUntil: "networkidle0" });
  expect("a fresh AI translation is not marked out of date", !(await page.$eval("main", (m) => m.innerText.includes("đã được sửa sau khi bản này được dịch"))));
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");
  await page.click('textarea[placeholder="Tiêu đề bài viết"]');
  await page.keyboard.press("End");
  await page.type('textarea[placeholder="Tiêu đề bài viết"]', " (sửa)");
  await saveNow();
  await page.goto(`${CMS}/admin/posts/${postId}?locale=en`, { waitUntil: "networkidle0" });
  expect("after the Vietnamese version changes, the English one is marked out of date", await page.$eval("main", (m) => m.innerText.includes("đã được sửa sau khi bản này được dịch")));

  // 4. The activity log records both uses of the AI.
  const activity = await admin.req("/admin/activity");
  expect("activity log records the AI draft and translation", activity.text.includes("Dùng AI viết nháp bản VI") && activity.text.includes("Dùng AI dịch bản VI sang bản EN"));

  // 5. "Fix with AI" in the SEO score, with the built-in AI: suggestions to review, then used.
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.click('[data-check="seoTitleLength"] [data-ai-fix], [data-check="keywordInTitle"] [data-ai-fix], [data-ai-fix-all]');
  await page.waitForSelector("[data-seo-fix]", { visible: true });
  expect("with an API key, 'Fix with AI' starts on the built-in AI", (await page.$eval('[data-seo-fix] [role="radio"][aria-checked="true"]', (b) => b.textContent)) === "AI tích hợp");
  await page.click("[data-seo-fix] button::-p-text(Nhờ AI đề xuất)");
  await page.waitForSelector("[data-seo-fix] [data-proposals]", { timeout: 20000 });
  const fixRequest = requests.at(-1);
  expect("the request asks only for the chosen fields through the seo_fields tool", fixRequest.tool_choice?.name === "seo_fields" && Object.keys(fixRequest.tools[0].input_schema.properties).every((k) => ["metaTitle", "metaDescription", "excerpt", "focusKeyword"].includes(k)));
  await page.click("[data-seo-fix] button::-p-text(Dùng)");
  await page.waitForFunction(() => !document.querySelector("[data-seo-fix]"));
  expect("the built-in AI's SEO title goes into the editor", (await page.$eval("#field-meta-title", (e) => e.value)).startsWith("[AI] "));
  expect("activity log records the AI SEO fix", (await admin.req("/admin/activity")).text.includes("Dùng AI sửa phần SEO bản VI"));
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await shot(page, "ai-99-error").catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  fake.close();
  if (postId) {
    const admin = new Client();
    await admin.login(ADMIN.email, ADMIN.password);
    await destroyPosts(admin, [postId]);
  }
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
