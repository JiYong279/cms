// Switching the interface to English leaves no Vietnamese interface text behind.
// Every Vietnamese string of the dictionaries is looked for in the English pages
// (article titles and other content are not in the dictionaries, so they don't count).
import { dictionaries } from "../../src/i18n/index.ts";
import { ADMIN, Client, check, somePublishedPost } from "./lib.mjs";

function leaves(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) leaves(v, out);
  return out;
}

const decode = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

// Vietnamese phrases with at least two words, split at placeholders; English copies are excluded.
const english = new Set(leaves(dictionaries.en));
const phrases = [
  ...new Set(
    leaves(dictionaries.vi)
      .filter((s) => !english.has(s))
      .flatMap((s) => s.split(/\{\w+\}/))
      .map((s) => s.trim())
      .filter((s) => s.split(/\s+/).length >= 2 && /[^\x00-\x7f]/.test(s)),
  ),
];

const admin = new Client({ cookie: "cms_lang=en" });
admin.cookies.set("cms_lang", "en");
let r = await admin.req("/login");
check("login page switches to English", r.text.includes("Sign in") && r.text.includes('lang="en"'));
await admin.login(ADMIN.email, ADMIN.password);
admin.cookies.set("cms_lang", "en");

// People's names are content, not interface text (the demo admin is called "Quản trị viên").
const account = await admin.req("/admin/account");
const myName = account.text.match(/name="name"[^>]*value="([^"]*)"/)?.[1] ?? account.text.match(/value="([^"]*)"[^>]*name="name"/)?.[1] ?? "";
const post = await somePublishedPost();
const pages = [
  "/admin",
  "/admin?view=trash",
  `/admin/posts/${post.id}?locale=vi`,
  `/admin/posts/${post.id}?locale=en`,
  "/admin/users",
  "/admin/users/new",
  "/admin/account",
  "/admin/settings",
  "/admin/activity",
];
for (const page of pages) {
  r = await admin.req(page);
  const text = myName ? decode(r.text).split(myName).join(" ") : decode(r.text);
  const left = phrases.filter((p) => text.includes(p));
  check(`English ${page} has no Vietnamese interface text`, r.status === 200 && left.length === 0, left.slice(0, 5).join(" | "));
}
