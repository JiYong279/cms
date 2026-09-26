// The editorial calendar: planned days, who looks after an article, and what each role may change.
import { ADMIN, EDITOR, WRITER, Client, check, destroyPosts } from "./lib.mjs";

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const editor = new Client();
await editor.login(EDITOR.email, EDITOR.password);
const writer = new Client();
await writer.login(WRITER.email, WRITER.password);

const usersHtml = (await admin.req("/admin/users")).text;
const idOf = (email) => usersHtml.split("<tr").find((row) => row.includes(email))?.match(/\/admin\/users\/([0-9a-f-]{36})/)?.[1];
const editorId = idOf(EDITOR.email);
const writerId = idOf(WRITER.email);

const created = [];
async function newPost(client) {
  const r = await client.submit("/admin", 'name="siteId"', { siteId: "qubx" });
  const id = r.location?.match(/posts\/([0-9a-f-]{36})/)?.[1];
  if (id) created.push(id);
  return id;
}
const plan = (client, input) => client.call("/admin/calendar", "planPost", [input]);
/** The day a card of this article sits on in the calendar of that month ("" when not planned). */
async function dayOnCalendar(client, postId, query) {
  const html = (await client.req(`/admin/calendar?${query}`)).text;
  return html.match(new RegExp(`data-post-id="${postId}" data-day="([0-9-]*)"`))?.[1];
}

try {
  await admin.req("/admin/calendar");
  const postId = await newPost(writer);
  check("writer creates an article to plan", !!postId);

  let r = await plan(writer, { postId, plannedFor: "2031-03-12" });
  check("writer plans own article", r.ok === true, JSON.stringify(r));
  check("the calendar shows it on its planned day", (await dayOnCalendar(writer, postId, "month=2031-03")) === "2031-03-12");

  r = await plan(admin, { postId, plannedFor: "2031-02-30" });
  check("an impossible day is refused", r.ok === false, JSON.stringify(r));

  r = await plan(admin, { postId, assigneeId: writerId });
  check("an article cannot be given to a writer", r.ok === false && /Chỉ giao được cho biên tập viên/.test(r.error), JSON.stringify(r));
  r = await plan(admin, { postId, assigneeId: editorId });
  check("admin gives the article to an editor", r.ok === true, JSON.stringify(r));
  check("it shows under the editor's 'mine'", (await dayOnCalendar(editor, postId, "month=2031-03&who=me")) === "2031-03-12");
  check("and not under the admin's 'mine'", (await dayOnCalendar(admin, postId, "month=2031-03&who=me")) === undefined);

  r = await plan(editor, { postId, plannedFor: null });
  check("editor removes the planned day", r.ok === true, JSON.stringify(r));
  check("it goes back to 'no date yet'", (await dayOnCalendar(admin, postId, "month=2031-03")) === "");

  const log = (await admin.req("/admin/activity")).text;
  check("the activity log records the plan and the assignment", log.includes("Đặt ngày dự kiến đăng") && log.includes(`Giao bài cho ${EDITOR.name}`) && log.includes("Bỏ ngày dự kiến đăng"));

  const trashedId = await newPost(admin);
  await admin.call("/admin", "trashPosts", [[trashedId]]);
  r = await plan(admin, { postId: trashedId, plannedFor: "2031-03-12" });
  check("an article in the trash cannot be planned", r.ok === false && /thùng rác/.test(r.error), JSON.stringify(r));
} finally {
  await destroyPosts(admin, created);
}
