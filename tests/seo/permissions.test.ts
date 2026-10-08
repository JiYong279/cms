// What each role may do: the defaults, an admin's changes to them, and what no change can touch.
//   npx tsx tests/seo/permissions.test.ts
import { EDITABLE_PERMISSIONS, can, canEditPost, setPermissionOverrides } from "../../src/lib/permissions";

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

setPermissionOverrides({});
check("by default writers cannot publish", !can("writer", "posts.publish"));
check("by default editors publish", can("editor", "posts.publish"));

setPermissionOverrides({ writer: { "posts.publish": true }, editor: { "posts.deleteAny": false } });
check("a writer granted publishing may publish", can("writer", "posts.publish"));
check("an editor whose deleting was removed may not delete others' articles", !can("editor", "posts.deleteAny"));
check("permissions nobody changed keep their default", can("editor", "posts.publish") && !can("writer", "posts.editAny"));

// Managing users and websites stays with admins, even if the database says otherwise.
setPermissionOverrides({ writer: { "users.manage": true, "sites.manage": true } });
check("users.manage cannot be granted to writers", !can("writer", "users.manage"));
check("sites.manage cannot be granted to writers", !can("writer", "sites.manage"));
check("users.manage is not among the editable permissions", !EDITABLE_PERMISSIONS.includes("users.manage"));

// Admins keep every permission whatever is saved (no admin row is ever read).
setPermissionOverrides({ editor: { "posts.publish": false }, writer: { "posts.create": false } });
check("admins hold every permission", EDITABLE_PERMISSIONS.every((p) => can("admin", p)) && can("admin", "users.manage"));

// "Edit own articles" now decides whether an author may open their own article.
const writer = { id: "w", role: "writer" as const };
setPermissionOverrides({});
check("by default a writer edits their own article", canEditPost(writer, { authorId: "w" }));
setPermissionOverrides({ writer: { "posts.editOwn": false } });
check("without 'edit own articles' a writer cannot edit their own article", !canEditPost(writer, { authorId: "w" }));
check("and still cannot edit someone else's", !canEditPost(writer, { authorId: "x" }));

setPermissionOverrides({});
console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
