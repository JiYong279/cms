// The content overview: the brief (who may change it, where it goes), pillar articles and the topic table.
import { ADMIN, EDITOR, Client, check, destroyPosts, has, readBrief, writeBrief } from "./lib.mjs";

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const editor = new Client();
await editor.login(EDITOR.email, EDITOR.password);

const URL_ = "/admin/overview?site=qubx";
const created = [];
const before = await readBrief(admin, "qubx");
try {
  let r = await admin.req(URL_);
  check("the overview opens with its sections", r.status === 200 && ["data-next-steps", "data-brief", "data-coverage", "data-weeks", "data-todo"].every((m) => has(r, m)));
  check("the sidebar links to it", has(r, 'href="/admin/overview"'));

  const brief = {
    audience: "Chủ phòng khám nha khoa thử nghiệm <b>e2e</b>",
    goal: "Lên top Google cho câu hỏi về nha khoa",
    offering: "",
    voice: "Thân thiện",
    avoid: "Không so sánh giá",
    notes: "",
  };
  await editor.req(URL_);
  let s = await editor.call(URL_, "saveBrief", [{ siteId: "qubx", brief, postsPerWeek: 3 }]);
  check("an editor saves the brief and the weekly target", s.ok === true, JSON.stringify(s));
  r = await admin.req(URL_);
  check("the overview shows the brief, escaped, and the target", has(r, "Chủ phòng khám nha khoa thử nghiệm &lt;b&gt;e2e&lt;/b&gt;") && has(r, "3 bài/tuần") && !has(r, "Chưa có định hướng"));
  check("with a target, the weeks are measured against it", /\d+\/3 bài/.test(r.text));

  s = await editor.call(URL_, "saveBrief", [{ siteId: "qubx", brief, postsPerWeek: 50 }]);
  check("an impossible weekly target is refused", s.ok === false, JSON.stringify(s));
  s = await editor.call(URL_, "saveBrief", [{ siteId: "khong-co", brief, postsPerWeek: 3 }]);
  check("an unknown website is refused", s.ok === false && /Không tìm thấy website/.test(s.error), JSON.stringify(s));

  const log = (await admin.req("/admin/activity")).text;
  check("the activity log records the change", log.includes("Sửa định hướng nội dung của Qub-X"));

  // The editor gets the brief, so the prompts copied into Claude carry it.
  r = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
  const postId = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
  if (postId) created.push(postId);
  const editorUrl = `/admin/posts/${postId}?locale=vi`;
  r = await admin.req(editorUrl);
  check("the article editor receives the brief for its AI prompts", has(r, "Lên top Google cho câu hỏi về nha khoa"));

  // Pillar articles: saved from the editor, kept when a save leaves the choice out, shown per topic.
  const categoryId = (await admin.req(URL_)).text.match(/data-topic="([0-9a-f-]{36})"/)?.[1];
  check("the topic table lists the website's categories", !!categoryId);
  const draft = {
    postId, locale: "vi", status: "draft", title: "E2E pillar draft", slug: "", excerpt: "",
    contentJson: null, contentHtml: "<p>Thử.</p>", metaTitle: "", metaDescription: "", focusKeyword: "",
    noindex: false, scheduledAt: null, categoryId, featured: false, coverImageUrl: "",
  };
  s = await admin.call(editorUrl, "savePost", [{ ...draft, pillar: true }]);
  check("an article is marked as its topic's pillar", s.ok === true, JSON.stringify(s));
  s = await admin.call(editorUrl, "savePost", [draft]);
  r = await admin.req(editorUrl);
  check("a save that leaves the choice out keeps it", s.ok === true && /\\"pillar\\":true/.test(r.text), JSON.stringify(s));
  const row = (await admin.req(URL_)).text.match(new RegExp(`<tr[^>]*data-topic="${categoryId}"[\\s\\S]*?</tr>`))?.[0] ?? "";
  check("the topic shows its pillar as being written", row.includes("Đang viết") && row.includes(`/admin/posts/${postId}`), row.slice(0, 300));

  // "Plan with AI" keeps the overview article of the cluster as the pillar, unless its topic has one.
  const idea = { title: "E2E planned overview", focusKeyword: "", pillar: true, plannedFor: "2031-06-02", why: "", outline: ["A"] };
  s = await admin.call("/admin/calendar", "createPlannedPosts", [
    { siteId: "qubx", locale: "vi", ideas: [{ ...idea, categoryId: null }, { ...idea, title: "E2E second overview", categoryId }] },
  ]);
  if (s.ok) created.push(...s.ids);
  const planned = s.ok ? await Promise.all(s.ids.map(async (id) => (await admin.req(`/admin/posts/${id}?locale=vi`)).text)) : ["", ""];
  check("a planned overview article is saved as the pillar", s.ok === true && /\\"pillar\\":true/.test(planned[0]), JSON.stringify(s).slice(0, 200));
  check("…but a topic that already has its pillar does not get a second one", s.ok === true && /\\"pillar\\":false/.test(planned[1]));

  // An article live in one language only: "Translate" opens the missing language.
  r = await admin.submit("/admin", 'name="siteId"', { siteId: "qubx" });
  const liveId = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
  if (liveId) created.push(liveId);
  s = await admin.call(`/admin/posts/${liveId}?locale=vi`, "savePost", [
    { ...draft, postId: liveId, status: "published", title: "E2E only in Vietnamese", categoryId: null },
  ]);
  const overview = (await admin.req(URL_)).text;
  check("'Translate' opens the language the article is missing", s.ok === true && overview.includes(`/admin/posts/${liveId}?locale=en&amp;ai=translate`), JSON.stringify(s).slice(0, 200));
} finally {
  await destroyPosts(admin, created);
  await admin.req(URL_);
  const s = await writeBrief(admin, before);
  check("the brief is put back as it was", s.ok === true, JSON.stringify(s));
}
