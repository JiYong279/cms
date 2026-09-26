import { ADMIN, Client, EDITOR, WRITER, check, destroyPosts, has, message, signedIn, somePublishedPost } from "./lib.mjs";

const admin = new Client();
let r = await admin.login(ADMIN.email, ADMIN.password);
check("admin logs in", signedIn(r), `${r.status} ${r.location}`);

r = await admin.req("/admin/users");
check("admin sees users page", r.status === 200 && has(r, "Phân quyền theo vai trò"));

// Create the test accounts, or reset them to the known password if they already exist.
const usersHtml = async () => (await admin.req("/admin/users")).text;
const idOf = (html, email) =>
  html.split("<tr").find((row) => row.includes(email))?.match(/\/admin\/users\/([0-9a-f-]{36})/)?.[1];
for (const [role, u] of [["editor", EDITOR], ["writer", WRITER]]) {
  r = await admin.submit("/admin/users/new", 'name="email"', { ...u, role });
  if (r.status === 303) {
    check(`${role} account created`, true);
    continue;
  }
  if (!has(r, "đã có tài khoản")) {
    check(`${role} account created`, false, message(r));
    continue;
  }
  const id = idOf(await usersHtml(), u.email);
  await admin.submit(`/admin/users/${id}`, 'name="active"', { id, name: u.name, role, active: "on" });
  const reset = await admin.submit(`/admin/users/${id}`, 'name="password"', { id, password: u.password });
  check(`${role} account reset to the test password`, has(reset, "Đã đặt mật khẩu mới"), message(reset));
}

r = await admin.submit("/admin/users/new", 'name="email"', { name: "X", email: "WRITER@example.com", password: "Str0ng-pass-x", role: "writer" });
check("duplicate email rejected (case-insensitive)", has(r, "đã có tài khoản"), message(r));
r = await admin.submit("/admin/users/new", 'name="email"', { name: "X", email: "x@example.com", password: "123", role: "writer" });
check("short password rejected", has(r, "ít nhất 8 ký tự"), message(r));
r = await admin.submit("/admin/users/new", 'name="email"', { name: "X", email: "x@example.com", password: "password1", role: "writer" });
check("common password rejected", has(r, "quá phổ biến"), message(r));

const html = await usersHtml();
const adminId = idOf(html, ADMIN.email);
const writerId = idOf(html, WRITER.email);
r = await admin.submit(`/admin/users/${adminId}`, 'name="active"', { id: adminId, name: "Quản trị viên", role: "writer", active: "on" });
check("admin cannot demote self", has(r, "không thể tự đổi vai trò"), message(r));

// Writer
const others = await somePublishedPost();
const writer = new Client();
r = await writer.login(WRITER.email, WRITER.password);
check("writer logs in", signedIn(r), `${r.status} ${r.location}`);
r = await writer.req("/admin");
check("writer list hides others' posts", r.status === 200 && !has(r, others.title) && has(r, "Các bài bạn đã viết"));
check("writer sidebar has no admin links", !has(r, 'href="/admin/users"') && !has(r, 'href="/admin/settings"'));
r = await writer.req("/admin/users");
check("writer blocked from users page", has(r, "Không có quyền truy cập"));
r = await writer.req("/admin/settings");
check("writer blocked from site settings", has(r, "Không có quyền truy cập"));
r = await writer.req(`/admin/posts/${others.id}?locale=vi`);
check("writer blocked from others' post", has(r, "Bài này thuộc về người khác"));

r = await writer.submit("/admin", 'name="siteId"', { siteId: "qubx" });
const postId = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
check("writer creates a post", !!postId, `${r.status} ${r.location}`);
const editorUrl = `/admin/posts/${postId}?locale=vi`;
const draft = {
  postId, locale: "vi", status: "published", title: "Bài thử của người viết", slug: "", excerpt: "Thử phân quyền.",
  contentJson: null, contentHtml: "<p>Nội dung thử.</p>", metaTitle: "", metaDescription: "", focusKeyword: "",
  noindex: false, scheduledAt: null, categoryId: null, featured: false, coverImageUrl: "",
};
let s = await writer.call(editorUrl, "savePost", [draft]);
check("writer cannot publish", s.ok === false && /không có quyền xuất bản/.test(s.error), JSON.stringify(s));
s = await writer.call(editorUrl, "savePost", [{ ...draft, status: "in_review" }]);
check("writer submits for review", s.ok === true && s.slug === "bai-thu-cua-nguoi-viet", JSON.stringify(s));
s = await writer.call(`/admin/posts/${others.id}?locale=vi`, "savePost", [{ ...draft, postId: others.id, status: "draft" }]);
check("writer cannot save others' post", s.ok === false && /không có quyền sửa/.test(s.error), JSON.stringify(s));
await writer.req("/admin/calendar");
s = await writer.call("/admin/calendar", "planPost", [{ postId, plannedFor: "2031-01-15" }]);
check("writer plans own post", s.ok === true, JSON.stringify(s));
s = await writer.call("/admin/calendar", "planPost", [{ postId, assigneeId: adminId }]);
check("writer cannot assign an article", s.ok === false && /Chỉ biên tập viên và quản trị viên được giao bài/.test(s.error), JSON.stringify(s));
s = await writer.call("/admin/calendar", "planPost", [{ postId: others.id, plannedFor: "2031-01-15" }]);
check("writer cannot plan others' post", s.ok === false && /không có quyền sửa/.test(s.error), JSON.stringify(s));

// Editor
const editor = new Client();
r = await editor.login(EDITOR.email, EDITOR.password);
check("editor logs in", signedIn(r), `${r.status} ${r.location}`);
r = await editor.req("/admin");
check("editor sees everyone's posts with author", has(r, others.title) && has(r, draft.title) && has(r, WRITER.name));
s = await editor.call(editorUrl, "savePost", [{ ...draft, status: "published" }]);
check("editor publishes writer's post", s.ok === true, JSON.stringify(s));
s = await writer.call(editorUrl, "savePost", [{ ...draft, status: "in_review" }]);
check("writer cannot edit own post once live", s.ok === false && /đang xuất bản/.test(s.error), JSON.stringify(s));
r = await editor.req("/admin/users");
check("editor blocked from users page", has(r, "Không có quyền truy cập"));

// Account page
const acct = (current, next, confirm) => editor.submit("/admin/account", 'name="confirm"', { current, next, confirm });
r = await acct("wrong", "E2e-Other-2026!", "E2e-Other-2026!");
check("wrong current password rejected", has(r, "Mật khẩu hiện tại không đúng"), message(r));
r = await acct(EDITOR.password, "E2e-Other-2026!", "x");
check("mismatched new password rejected", has(r, "không khớp"), message(r));
r = await acct(EDITOR.password, "editor123", "editor123");
check("weak new password rejected", has(r, "quá phổ biến"), message(r));
r = await acct(EDITOR.password, "E2e-Other-2026!", "E2e-Other-2026!");
check("editor changes password", has(r, "Đã đổi mật khẩu"), message(r));
check("editor stays signed in on this device", (await editor.req("/admin")).status === 200);
r = await acct("E2e-Other-2026!", EDITOR.password, EDITOR.password);
check("editor password restored", has(r, "Đã đổi mật khẩu"), message(r));

// Locking an account signs it out
r = await admin.submit(`/admin/users/${writerId}`, 'name="active"', { id: writerId, name: WRITER.name, role: "writer" });
check("admin locks writer", has(r, "Đã vô hiệu hoá tài khoản"), message(r));
r = await writer.req("/admin");
check("locked writer is signed out", r.status === 307, r.status);
r = await new Client().login(WRITER.email, WRITER.password);
check("locked writer cannot log in", has(r, "Email hoặc mật khẩu không đúng"), r.status);
r = await admin.submit(`/admin/users/${writerId}`, 'name="active"', { id: writerId, name: WRITER.name, role: "writer", active: "on" });
check("admin unlocks writer", has(r, "Đã lưu thay đổi"), message(r));

// Too many wrong passwords pause sign-in (own address, so other checks are not affected).
const guesser = new Client({ "x-real-ip": `e2e-${Date.now()}` });
const target = `nobody-${Date.now()}@example.com`;
for (let i = 0; i < 5; i++) await guesser.login(target, "wrong-password");
r = await guesser.login(target, "wrong-password");
check("sign-in paused after 5 failures", has(r, "quá nhiều lần"), message(r));

// Trash rules: a writer can trash only their own unpublished article, and cannot purge.
// (Locking signed the writer out above.)
r = await writer.login(WRITER.email, WRITER.password);
check("unlocked writer signs in again", signedIn(r), `${r.status} ${r.location}`);
await admin.req("/admin");
let t = await writer.call("/admin", "trashPosts", [[others.id]]);
check("writer cannot trash someone else's article", t.done === 0 && t.skipped === 1, JSON.stringify(t));
t = await writer.call("/admin", "trashPosts", [[postId]]);
check("writer cannot trash own article once live", t.done === 0, JSON.stringify(t));
r = await writer.req("/admin/activity");
check("writer cannot see the activity log", has(r, "Không có quyền truy cập"));
r = await editor.req("/admin/activity");
check("editor sees the activity log", r.status === 200 && has(r, "Nhật ký hoạt động") && has(r, "Xuất bản bản VI"));
t = await editor.call("/admin", "trashPosts", [[postId]]);
check("editor trashes it", t.done === 1, JSON.stringify(t));
t = await writer.call("/admin?view=trash", "deletePostsForever", [[postId]]);
check("writer cannot delete forever", t.done === 0, JSON.stringify(t));

// Clean up
await destroyPosts(admin, [postId]);
check("test post removed", (await admin.req(editorUrl)).status === 404);
