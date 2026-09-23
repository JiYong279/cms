// Shared helpers for the end-to-end checks. They drive a running dev server over HTTP,
// the way a browser without JavaScript would, plus direct Server Action calls.
import fs from "node:fs";
import path from "node:path";

export const CMS = (process.env.E2E_CMS_URL ?? "http://localhost:3001").replace(/\/$/, "");
export const QUBX = (process.env.E2E_QUBX_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@example.com",
  password: process.env.E2E_ADMIN_PASSWORD ?? "admin123",
};
/** Accounts the checks create (or reset) with known strong passwords. */
export const EDITOR = { email: "editor@example.com", name: "Biên Tập Viên", password: "E2e-Editor-2026!" };
export const WRITER = { email: "writer@example.com", name: "Người Viết", password: "E2e-Writer-2026!" };

/** Server Action ids are generated per build; read them from the dev server's manifests. */
export function actionId(name) {
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) {
        const found = walk(p);
        if (found) return found;
      } else if (f === "server-reference-manifest.json") {
        const manifest = JSON.parse(fs.readFileSync(p, "utf8"));
        for (const [id, v] of Object.entries(manifest.node ?? {})) if (v.exportedName === name) return id;
      }
    }
  };
  const id = walk(path.join(process.cwd(), ".next", "dev", "server"));
  if (!id) throw new Error(`Server Action ${name} not found: open a page that uses it first`);
  return id;
}

export class Client {
  cookies = new Map();
  constructor(extraHeaders = {}) {
    this.extraHeaders = extraHeaders;
  }
  async req(url, init = {}) {
    const headers = new Headers({ ...this.extraHeaders, ...Object.fromEntries(new Headers(init.headers)) });
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(url.startsWith("http") ? url : CMS + url, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=");
      if (/expires=Thu, 01 Jan 1970/i.test(c) || v === "") this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  }
  /** Submits the form on `url` that contains `marker`, keeping its hidden fields. */
  async submit(url, marker, fields) {
    const page = await this.req(url);
    const form = (page.text.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes(marker));
    if (!form) throw new Error(`No form with ${marker} on ${url}`);
    const body = new FormData();
    for (const m of form.matchAll(/<input type="hidden" name="([^"]*)"(?: value="([^"]*)")?/g)) {
      body.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    }
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return this.req(url, { method: "POST", body });
  }
  /** Calls a Server Action with JSON arguments and returns its result. */
  async call(pageUrl, name, args) {
    const res = await this.req(pageUrl, {
      method: "POST",
      headers: { "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
      body: JSON.stringify(args),
    });
    const line = res.text.split("\n").find((l) => l.startsWith("1:{"));
    return line ? JSON.parse(line.slice(2)) : res;
  }
  login(email, password) {
    return this.submit("/login", 'name="password"', { email, password });
  }
}

let failures = 0;
export function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  -> ${detail}` : ""}`);
}
export const failed = () => failures;
export const has = (res, text) => res.text.includes(text);
export const message = (res) => (res.text.match(/role="(?:alert|status)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)/) ?? [])[1];
export const signedIn = (res) => res.status === 303 && /\/admin(\/account\?weak=1)?$/.test(res.location ?? "");

/** Deletes articles for good: to the trash first, then out of it. */
export async function destroyPosts(client, ids) {
  if (!ids.length) return;
  await client.req("/admin");
  await client.call("/admin", "trashPosts", [ids]);
  await client.call("/admin?view=trash", "deletePostsForever", [ids]);
}

/** Any published Qub-X article, to test access to someone else's post. */
export async function somePublishedPost() {
  const res = await fetch(`${CMS}/api/public/v1/sites/qubx/posts?locale=vi`);
  const { posts } = await res.json();
  if (!posts.length) throw new Error("No published Qub-X article: run npm run db:import-qubx -- --replace");
  return posts[0];
}
