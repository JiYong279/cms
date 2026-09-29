// A pass over every dialog and panel with long, realistic content at three screen widths: nothing may
// spill out of its dialog or make the page scroll sideways. Screenshots go to screenshots/ui-*.png.
//   npm run test:ui-review
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { ADMIN, CMS, Client, destroyPosts } from "../e2e/lib.mjs";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Long, realistic content: the kind that breaks layouts.
const TITLE = "Hồ sơ bệnh án điện tử (EMR) cho phòng khám thẩm mỹ: bắt đầu từ đâu và cần chuẩn bị những gì trước hạn 31/12/2026?";
const LONG = "Hồ sơ bệnh án điện tử (EMR) cho phòng khám thẩm mỹ: cần lưu gì, lợi ích so với hồ sơ giấy, bảo mật dữ liệu và lộ trình triển khai 4 bước.";
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
const html = [
  "<h2>Vì sao cần bệnh án điện tử</h2><p>Mở đầu.</p>",
  `<img src="${CMS}/icon.png" alt="" data-rights="unknown" data-credit="Cổng thông tin điện tử Bộ Y tế – Cục Quản lý Khám, chữa bệnh">`,
  '<div data-image-suggestion="" data-alt="Lễ tân phòng khám thẩm mỹ đón khách tại quầy, phía sau là màn hình lịch hẹn Qub-X" data-caption="Quầy lễ tân dùng lịch hẹn điện tử">Ảnh chụp thật tại quầy lễ tân một phòng khám thẩm mỹ, thấy rõ màn hình lịch hẹn và hồ sơ khách hàng trên phần mềm</div>',
  '<table data-caption="Hạn triển khai hồ sơ bệnh án điện tử theo Thông tư 13/2025/TT-BYT theo từng loại cơ sở khám bệnh, chữa bệnh"><tbody><tr><th><p>Loại cơ sở</p></th><th><p>Hạn</p></th></tr><tr><td><p>Phòng khám</p></td><td><p>31/12/2026</p></td></tr></tbody></table>',
].join("");
await admin.call(`/admin/posts/${postId}?locale=vi`, "savePost", [
  {
    postId, locale: "vi", status: "draft", title: TITLE, slug: "ho-so-benh-an-dien-tu-emr-phong-kham-tham-my-thu-giao-dien-dai", excerpt: LONG,
    contentHtml: html, contentJson: null, metaTitle: "", metaDescription: LONG, focusKeyword: "hồ sơ bệnh án điện tử",
    noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: `${CMS}/icon.png`,
    coverImageAlt: "Minh hoạ phần mềm quản lý hồ sơ bệnh án điện tử trên máy tính bảng tại phòng khám thẩm mỹ",
  },
]);
// The editor opens a document, not HTML: load the HTML into it once, then save.
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Chrome asks for /favicon.ico by itself; the CMS icon is icon.png.
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && errors.push(`console: ${m.text()}`));

/** Elements sticking out of `container` (or the page scrolling sideways when no container). */
async function overflow(container) {
  return page.evaluate((sel) => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    const box = sel && document.querySelector(sel);
    if (box) {
      const r = box.getBoundingClientRect();
      for (const el of box.querySelectorAll("*")) {
        const e = el.getBoundingClientRect();
        if (e.width === 0 || e.height === 0) continue;
        if (e.right > r.right + 1 || e.left < r.left - 1) {
          const label = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.split(" ").slice(0, 2).join(".")}` : ""}: "${(el.textContent ?? "").trim().slice(0, 40)}"`;
          if (!out.includes(label)) out.push(label);
        }
      }
    }
    return out.slice(0, 5);
  }, container ?? null);
}

async function check(name, container, width) {
  await sleep(250);
  const spill = await overflow(container);
  expect(`${width}px ${name}: nothing spills out`, spill.length === 0, spill.join(" | "));
  await page.screenshot({ path: `${OUT}ui-${width}-${name}.png` });
}
const closeDialog = async () => {
  await page.keyboard.press("Escape");
  await sleep(200);
};

try {
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto(`${CMS}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', ADMIN.email);
  await page.type('input[name="password"]', ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");
  await page.evaluate((h) => document.querySelector(".ProseMirror").editor.commands.setContent(h), html);
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector("header").innerText.includes("Đã lưu") && !document.querySelector("header").innerText.includes("Chưa lưu"), { timeout: 20000 });

  for (const width of [1440, 1024, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${CMS}/admin/posts/${postId}?locale=vi`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-image-suggestion-view]");
    await check("editor", null, width);

    // SEO fix dialog, every field ticked (the long ones included).
    // On phones the SEO panel is a drawer: open it first, as a person would.
    if (width === 390) {
      await page.click('header button[title="Cài đặt bài viết"]');
      await page.waitForSelector("[data-ai-fix-all]", { visible: true });
    }
    await page.click("[data-ai-fix-all]");
    if (await page.waitForSelector("[data-seo-fix]", { visible: true, timeout: 5000 }).catch(() => null)) {
      for (const box of await page.$$('[data-seo-fix] input[data-field]:not(:checked)')) await box.click();
      await check("seo-fix", "[data-seo-fix]", width);
      await closeDialog();
    } else {
      expect(`${width}px seo-fix dialog opens`, false);
    }
    const open = await page.$$eval('[role="dialog"]', (ds) => ds.length);
    expect(`${width}px Escape closes the dialog`, open === 0, `${open} still open`);
    if (width === 390) await page.evaluate(() => [...document.querySelectorAll("aside button")].find((b) => b.querySelector("svg") && !b.textContent?.trim())?.click());

    // AI dialog, translate tab.
    await page.evaluate(() => [...document.querySelectorAll("header button")].find((b) => b.textContent?.trim() === "AI")?.click());
    await page.waitForSelector('[role="dialog"]', { visible: true });
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes("Dịch bài"))?.click());
    await check("ai-dialog", '[role="dialog"]', width);
    await closeDialog();

    // Publish dialog: unknown image and leftover suggestion warnings.
    await page.evaluate(() => [...document.querySelectorAll("header button")].find((b) => b.textContent?.includes("Đăng bài"))?.click());
    if (await page.waitForSelector("[data-unknown-images]", { visible: true, timeout: 5000 }).catch(() => null)) {
      await check("publish", '[role="dialog"]', width);
      await closeDialog();
    } else {
      expect(`${width}px publish dialog opens`, false);
    }

    // Image bubble on the credited image.
    await page.evaluate(() => document.querySelector('.ProseMirror img[data-rights]')?.scrollIntoView({ block: "center" }));
    await page.click(".ProseMirror img[data-rights]").catch(() => {});
    if (await page.waitForSelector("[data-image-rights]", { visible: true, timeout: 4000 }).catch(() => null)) {
      const bubble = await page.evaluateHandle(() => document.querySelector("[data-image-rights]").closest("[data-state], .tippy-box, div[style*='position']") ?? document.querySelector("[data-image-rights]").parentElement.parentElement);
      const inView = await bubble.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return r.left >= -1 && r.right <= window.innerWidth + 1;
      });
      expect(`${width}px image bubble stays on screen`, inView);
      await check("image-bubble", null, width);
    }

    // Table bubble, with its long caption.
    await page.evaluate(() => document.querySelector(".ProseMirror td")?.scrollIntoView({ block: "center" }));
    await page.click(".ProseMirror td");
    if (await page.waitForSelector("[data-table-caption]", { visible: true, timeout: 4000 }).catch(() => null)) {
      const inView = await page.$eval("[data-table-caption]", (input) => {
        let box = input;
        while (box.parentElement && box.parentElement !== document.body && getComputedStyle(box).position !== "absolute" && getComputedStyle(box).position !== "fixed") box = box.parentElement;
        const r = box.getBoundingClientRect();
        return r.left >= -1 && r.right <= window.innerWidth + 1;
      });
      expect(`${width}px table bubble stays on screen`, inView);
      await check("table-bubble", null, width);
    } else {
      expect(`${width}px table bubble opens`, false);
    }

    // Suggestion block and the stock photo picker (no key here: it explains how to switch it on).
    await page.evaluate(() => document.querySelector("[data-image-suggestion-view]")?.scrollIntoView({ block: "center" }));
    await check("suggestion", "[data-image-suggestion-view]", width);
    await page.evaluate(() => [...document.querySelectorAll("[data-image-suggestion-view] button")].find((b) => b.textContent?.includes("Tìm ảnh miễn phí"))?.click());
    if (await page.waitForSelector("[data-stock-dialog]", { visible: true, timeout: 5000 }).catch(() => null)) {
      await sleep(800);
      await check("stock", "[data-stock-dialog]", width);
      await closeDialog();
    }

    // Calendar and the plan dialog.
    await page.goto(`${CMS}/admin/calendar?site=qubx`, { waitUntil: "networkidle0" });
    await check("calendar", null, width);
    await page.click("[data-plan-ai]");
    await page.waitForSelector("[data-plan-dialog]", { visible: true });
    await check("plan", "[data-plan-dialog]", width);
    await closeDialog();
  }
} catch (error) {
  failures++;
  console.log("ERROR:", error.message);
  await page.screenshot({ path: `${OUT}ui-99-error.png` }).catch(() => {});
} finally {
  expect("no errors in the browser console", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  await destroyPosts(admin, postId ? [postId] : []);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}
