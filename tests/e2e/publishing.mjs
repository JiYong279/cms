import { ADMIN, CMS, QUBX, Client, check, destroyPosts, has } from "./lib.mjs";

const qubxUp = await fetch(`${QUBX}/blog`, { signal: AbortSignal.timeout(60_000) }).then((r) => r.ok, () => false);
if (!qubxUp) {
  console.log(`SKIP  publishing checks: Qub-X is not running at ${QUBX}`);
} else {
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = (path) => fetch(`${CMS}/api/public/v1/sites/qubx${path}`);

  const settings = await admin.req("/admin/settings");
  check("settings page lists Qub-X with its refresh URL", has(settings, "Qub-X") && has(settings, "/api/cms/revalidate"));

  // Edit an English article and watch Qub-X follow.
  const summary = (await (await api("/posts?locale=en")).json()).posts[0];
  const { post } = await (await api(`/posts/${summary.slug}?locale=en`)).json();
  const pageUrl = `/admin/posts/${post.id}?locale=en`;
  await admin.req(pageUrl);
  const base = {
    postId: post.id, locale: "en", status: "published", title: post.title, slug: post.slug, excerpt: post.excerpt,
    contentJson: post.content, contentHtml: post.html, metaTitle: post.metaTitle, metaDescription: post.metaDescription,
    focusKeyword: "", noindex: false, scheduledAt: null, categoryId: post.category?.id ?? null, featured: post.featured,
    coverImageUrl: post.coverImageUrl ?? "",
  };
  const h1 = async (path) => (await (await fetch(QUBX + path)).text()).match(/<h1[^>]*>([^<]*)/)?.[1];

  let s = await admin.call(pageUrl, "savePost", [{ ...base, title: `${post.title} (edited)` }]);
  await wait(3000);
  check("title edit reaches Qub-X", s.ok && (await h1(`/blog/${post.slug}`)) === `${post.title} (edited)`);

  // Rename the slug: the old address must keep working.
  s = await admin.call(pageUrl, "savePost", [{ ...base, slug: `${post.slug}-renamed` }]);
  await wait(3000);
  const moved = await api(`/posts/${post.slug}?locale=en`);
  check("API reports the renamed article", moved.status === 301 && (await moved.json()).movedTo === `${post.slug}-renamed`);
  const old = await fetch(`${QUBX}/blog/${post.slug}`, { redirect: "manual" });
  check("old Qub-X link redirects to the new one", old.status === 308 && old.headers.get("location")?.endsWith(`/blog/${post.slug}-renamed`), `${old.status} ${old.headers.get("location")}`);

  s = await admin.call(pageUrl, "savePost", [base]);
  await wait(3000);
  check("article restored", s.ok && (await h1(`/blog/${post.slug}`)) === post.title);

  // A scheduled article goes live on its own once its time has passed.
  const created = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
  const postId = created.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
  const draftUrl = `/admin/posts/${postId}?locale=vi`;
  await admin.req(draftUrl);
  s = await admin.call(draftUrl, "savePost", [{
    ...base, postId, locale: "vi", status: "scheduled", title: "Bài hẹn giờ thử", slug: "", excerpt: "Thử hẹn giờ.",
    contentJson: null, contentHtml: "<p>Thử.</p>", metaTitle: "", metaDescription: "", categoryId: null, featured: false,
    coverImageUrl: "", scheduledAt: new Date(Date.now() - 60_000).toISOString(),
  }]);
  check("scheduled article saved", s.ok, JSON.stringify(s));
  const cron = await fetch(`${CMS}/api/cron/publish-scheduled`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  if (process.env.CRON_SECRET) check("cron endpoint publishes it", cron.ok, cron.status);
  else check("cron endpoint refuses without secret", cron.status === 401, cron.status);
  const list = await (await api("/posts?locale=vi")).json();
  check("scheduled article is live", list.posts.some((p) => p.slug === "bai-hen-gio-thu"));
  const listed = await admin.req(`/admin?status=published&q=${encodeURIComponent("bai hen gio thu")}`);
  check("CMS lists it as published", listed.text.includes("Bài hẹn giờ thử"));

  // The trash hides an article from the website at once; restoring brings it back.
  await admin.req("/admin");
  let t = await admin.call("/admin", "trashPosts", [[postId]]);
  await wait(3000);
  check("trashed article leaves Qub-X", t.done === 1 && !(await (await fetch(`${QUBX}/vi/blog`)).text()).includes("Bài hẹn giờ thử"));
  check("trashed article is gone from the API", (await api("/posts/bai-hen-gio-thu?locale=vi")).status === 404);
  const trashView = await admin.req("/admin?view=trash");
  check("trash view lists it", trashView.text.includes("Bài hẹn giờ thử"));
  const blocked = await admin.call(draftUrl, "savePost", [
    { ...base, postId, locale: "vi", status: "draft", title: "x", slug: "", categoryId: null, featured: false, coverImageUrl: "" },
  ]);
  check("a trashed article cannot be edited", blocked.ok === false && /thùng rác/.test(blocked.error), JSON.stringify(blocked));
  t = await admin.call("/admin?view=trash", "restorePosts", [[postId]]);
  await wait(3000);
  check("restored article is back on Qub-X", t.done === 1 && (await (await fetch(`${QUBX}/vi/blog`)).text()).includes("Bài hẹn giờ thử"));

  // Everything above is in the activity log, newest first.
  const log = await admin.req("/admin/activity?type=post");
  const order = ["Khôi phục từ thùng rác", "Chuyển vào thùng rác", "Tự xuất bản bản VI theo lịch hẹn"].map((s) => log.text.indexOf(s));
  check(
    "activity log records trash, restore and scheduled publishing in order",
    order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2],
    JSON.stringify(order),
  );
  const editor = await admin.req(draftUrl);
  check("the editor shows the article's history", editor.text.includes("Lịch sử") && editor.text.includes("Khôi phục từ thùng rác"));

  await destroyPosts(admin, [postId]);
  await wait(3000);
  check("deleted article leaves Qub-X", !(await (await fetch(`${QUBX}/vi/blog`)).text()).includes("Bài hẹn giờ thử"));
  check("deleting forever is logged", (await admin.req("/admin/activity?type=post")).text.includes("Xoá vĩnh viễn"));

  const bad = await fetch(`${QUBX}/api/cms/revalidate`, { method: "POST", headers: { "x-cms-secret": "wrong" } });
  check("Qub-X refuses a wrong secret", bad.status === 401, bad.status);
}
