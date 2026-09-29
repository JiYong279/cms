// Images whose rights are unknown never reach the website: publishing them is refused until an editor
// confirms them (they then arrive as "permitted"), and the confirmation is logged.
import { ADMIN, Client, check, destroyPosts } from "./lib.mjs";

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
const editorUrl = `/admin/posts/${postId}?locale=vi`;
const unknown = '<p>Mở đầu.</p><img src="https://example.org/anh.webp" alt="Ảnh lạ" data-rights="unknown" data-credit="Không rõ">';
const article = {
  postId, locale: "vi", title: "Bài thử quyền ảnh", slug: "bai-thu-quyen-anh", excerpt: "x", contentJson: null,
  metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
};

try {
  let r = await admin.call(editorUrl, "savePost", [{ ...article, status: "draft", contentHtml: unknown }]);
  check("a draft may hold an image of unknown rights", r.ok === true, JSON.stringify(r));

  r = await admin.call(editorUrl, "savePost", [{ ...article, status: "published", contentHtml: unknown }]);
  check("publishing it is refused, naming how many images", r.ok === false && /1 ảnh chưa rõ quyền/.test(r.error), JSON.stringify(r));

  r = await admin.call(editorUrl, "savePost", [{ ...article, status: "scheduled", scheduledAt: "2031-01-01T08:00:00.000Z", contentHtml: unknown }]);
  check("scheduling it is refused too", r.ok === false, JSON.stringify(r));

  r = await admin.call(editorUrl, "savePost", [{ ...article, status: "published", contentHtml: unknown.replace('data-rights="unknown"', 'data-rights="permitted"'), imagesConfirmed: 1 }]);
  check("once confirmed, it is published", r.ok === true, JSON.stringify(r));
  const log = (await admin.req("/admin/activity")).text;
  check("the activity log records who confirmed the image", log.includes("Xác nhận được phép dùng 1 ảnh trong bản VI"));

  const api = await (await fetch(`${process.env.E2E_CMS_URL ?? "http://localhost:3001"}/api/public/v1/sites/qubx/posts/bai-thu-quyen-anh?locale=vi`)).json();
  const html = (api.post ?? api).html ?? "";
  check("the website gets the image with its credit", html.includes('data-credit="Không rõ"') && !html.includes('data-rights="unknown"'), html.slice(0, 200));
} finally {
  await destroyPosts(admin, postId ? [postId] : []);
}
