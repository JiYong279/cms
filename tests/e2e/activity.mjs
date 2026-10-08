import { ADMIN, Client, EDITOR, check, destroyPosts, has, signedIn } from "./lib.mjs";

// The activity log says what a save changed: which fields, from what to what.
const admin = new Client();
let r = await admin.login(ADMIN.email, ADMIN.password);
check("admin logs in", signedIn(r), `${r.status} ${r.location}`);

r = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
check("a test article is created", !!postId, `${r.status} ${r.location}`);
const url = `/admin/posts/${postId}?locale=vi`;
await admin.req(url);

const stamp = Date.now();
const first = `Nhật ký thử ${stamp}`;
const second = `Nhật ký thử ${stamp} sửa`;
const draft = {
  postId, locale: "vi", status: "in_review", title: first, slug: "", excerpt: "", contentJson: null,
  contentHtml: "<p>một hai ba</p>", metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false,
  scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
};
let s = await admin.call(url, "savePost", [draft]);
check("submitted for review", s.ok === true, JSON.stringify(s));
s = await admin.call(url, "savePost", [{ ...draft, title: second, contentHtml: "<p>một hai ba bốn năm</p>" }]);
check("title and body edited", s.ok === true, JSON.stringify(s));
// A third save in the same editing session joins the same entry.
s = await admin.call(url, "savePost", [{ ...draft, title: second, contentHtml: "<p>một hai ba bốn năm</p>", metaDescription: "Mô tả SEO thử", noindex: true }]);
check("SEO fields edited", s.ok === true, JSON.stringify(s));

r = await admin.req("/admin/activity");
check("the log shows the old and new title", has(r, `Tiêu đề: “${first}” → “${second}”`));
check("the log shows the body's word count", has(r, "Nội dung: 3 → 5 chữ (+2)"));
check("the log shows the new meta description", has(r, "Mô tả SEO: “Mô tả SEO thử”"));
check("the log shows a switched setting", has(r, "Ẩn khỏi Google: bật"));
check("the log shows the renamed address", has(r, "Đường dẫn: “nhat-ky-thu-"));
// Counted in the visible page: the page's data for React (in <script>) repeats every text.
const visible = r.text.replace(/<script[\s\S]*?<\/script>/g, "");
check("one editing session is one entry", visible.split(`→ “${second}”`).length - 1 === 1);
check("the first save says how long the body was", has(r, `Tiêu đề: “${first}”`) && has(r, "Nội dung: 0 → 3 chữ (+3)"));
r = await admin.req(url);
check("the article's history shows the same details", has(r, "Nội dung: 3 → 5 chữ (+2)"));

// The IP address of a sign-in is shown to admins only.
r = await admin.req("/admin/activity?type=auth");
check("admins see the IP address of sign-ins", has(r, "Địa chỉ IP:"));
const editor = new Client();
r = await editor.login(EDITOR.email, EDITOR.password);
check("editor logs in", signedIn(r), `${r.status} ${r.location}`);
r = await editor.req("/admin/activity?type=auth");
check("editors do not see IP addresses", r.status === 200 && has(r, "Nhật ký hoạt động") && !has(r, "Địa chỉ IP:"));

await destroyPosts(admin, [postId]);
check("test article removed", (await admin.req(url)).status === 404);

// Website settings: each changed setting, from what to what. The Qub-X settings are put back after.
const SITE_FORM = '<input type="hidden" name="id" value="qubx"';
const form = ((await admin.req("/admin/settings")).text.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes(SITE_FORM));
const field = (name) => form?.match(new RegExp(`name="${name}"[^>]*?value="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&") ?? "";
const original = {
  id: "qubx",
  name: field("name"),
  baseUrl: field("baseUrl"),
  blogPathVi: field("blogPathVi"),
  blogPathEn: field("blogPathEn"),
  defaultLocale: form?.match(/<option value="(\w+)" selected/)?.[1] ?? "",
  revalidateUrl: field("revalidateUrl"),
};
check("the Qub-X settings are read", !!original.name && !!original.baseUrl && !!original.defaultLocale, JSON.stringify(original));
await admin.submit("/admin/settings", SITE_FORM, { ...original, name: `${original.name} e2e` });
r = await admin.req("/admin/activity?type=site");
check("the log shows a website setting before and after", has(r, `Tên website: “${original.name}” → “${original.name} e2e”`));
await admin.submit("/admin/settings", SITE_FORM, original);
r = await admin.req("/admin/settings");
check("the Qub-X settings are back", has(r, `value="${original.name}"`) && !has(r, `${original.name} e2e`));
