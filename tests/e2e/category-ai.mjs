// AI help with categories, the parts that change data: applying proposed categories and sorting
// articles into them. Who may do it, what is kept (addresses), and what the log records.
import { ADMIN, WRITER, Client, check, destroyPosts } from "./lib.mjs";

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const writer = new Client();
await writer.login(WRITER.email, WRITER.password);

const PAGE = "/admin/categories";
const NAME = "Chủ đề thử e2e AI";
const created = [];
let categoryId = null;

try {
  await admin.req(PAGE);
  const idea = { nameVi: NAME, nameEn: "E2E AI topic", descriptionVi: "Giới thiệu thử.", descriptionEn: "Test intro." };
  let s = await writer.call(PAGE, "applyCategoryPlan", [{ siteId: "qubx", create: [idea], rename: [] }]);
  check("a writer cannot apply proposed categories", s.ok === false && /Chỉ biên tập viên và quản trị viên/.test(s.error), JSON.stringify(s));

  s = await admin.call(PAGE, "applyCategoryPlan", [{ siteId: "qubx", create: [idea], rename: [] }]);
  check("an admin creates a proposed category", s.ok === true && s.created === 1 && s.renamed === 0, JSON.stringify(s));
  let html = (await admin.req(PAGE)).text;
  categoryId = html.match(new RegExp(`\\\\"id\\\\":\\\\"([0-9a-f-]{36})\\\\",\\\\"nameVi\\\\":\\\\"${NAME}\\\\"`))?.[1] ?? null;
  check("it shows with an address made from its name", !!categoryId && html.includes(">chu-de-thu-e2e-ai<"));

  s = await admin.call(PAGE, "applyCategoryPlan", [{ siteId: "qubx", create: [idea], rename: [] }]);
  check("a category whose address is taken is refused", s.ok === false && /đã được danh mục khác dùng/.test(s.error), JSON.stringify(s));

  s = await admin.call(PAGE, "applyCategoryPlan", [
    { siteId: "qubx", create: [], rename: [{ id: categoryId, ...idea, nameVi: `${NAME} đổi tên`, descriptionVi: "AI viết lại phần giới thiệu" }] },
  ]);
  html = (await admin.req(PAGE)).text;
  check("a renamed category keeps its address, so old links still work", s.ok === true && s.renamed === 1 && html.includes(`${NAME} đổi tên`) && html.includes(">chu-de-thu-e2e-ai<"), JSON.stringify(s));
  check("…and keeps the introduction the team wrote", html.includes("Giới thiệu thử.") && !html.includes("AI viết lại phần giới thiệu"));

  // Sorting articles into categories.
  const r = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
  const postId = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
  if (postId) created.push(postId);
  await admin.call(`/admin/posts/${postId}?locale=vi`, "savePost", [
    {
      postId, locale: "vi", status: "draft", title: "E2E uncategorised", slug: "", excerpt: "", contentJson: null, contentHtml: "<p>x</p>",
      metaTitle: "", metaDescription: "", focusKeyword: "", noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
    },
  ]);
  html = (await admin.req("/admin/overview?site=qubx")).text;
  check("the overview asks to sort articles without a category", html.includes('data-step="uncategorized"') && html.includes("data-place-articles"));

  await writer.req("/admin");
  s = await writer.call(PAGE, "applyPlacements", [{ siteId: "qubx", placements: [{ postId, categoryId }] }]);
  check("a writer cannot sort articles", s.ok === false, JSON.stringify(s));
  s = await admin.call(PAGE, "applyPlacements", [{ siteId: "qubx", placements: [{ postId, categoryId: "00000000-0000-4000-8000-000000000000" }] }]);
  check("a category of no website of this article is refused", s.ok === false, JSON.stringify(s));
  s = await admin.call(PAGE, "applyPlacements", [{ siteId: "qubx", placements: [{ postId, categoryId }] }]);
  const editor = (await admin.req(`/admin/posts/${postId}?locale=vi`)).text;
  check("an admin sorts the article into the category", s.ok === true && s.n === 1 && editor.includes(`\\"categoryId\\":\\"${categoryId}\\"`), JSON.stringify(s));
  const log = (await admin.req("/admin/activity")).text;
  check("the log records the new, renamed and sorted category", log.includes(`Thêm danh mục ${NAME}`) && log.includes(`Sửa danh mục ${NAME} đổi tên`) && log.includes(`Xếp vào danh mục ${NAME} đổi tên`));
} finally {
  await destroyPosts(admin, created);
  if (categoryId) {
    await admin.req(PAGE);
    await admin.call(PAGE, "deleteCategory", [categoryId]);
  }
}
