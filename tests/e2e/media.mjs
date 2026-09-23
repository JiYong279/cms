import { createRequire } from "node:module";
import { ADMIN, CMS, Client, check, somePublishedPost } from "./lib.mjs";

const sharp = createRequire(import.meta.url)("sharp");
const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);

const anonymous = new FormData();
anonymous.set("file", new File([Buffer.from("x")], "a.png", { type: "image/png" }));
let res = await fetch(`${CMS}/api/media`, { method: "POST", body: anonymous });
check("upload requires sign-in", res.status === 401, res.status);

// A large screenshot-like PNG with a Vietnamese file name.
const png = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: "#0a6b45" } }).png().toBuffer();
const form = new FormData();
form.set("file", new File([png], "Ảnh chụp màn hình.png", { type: "image/png" }));
form.set("siteId", "qubx");
const upload = await admin.req("/api/media", { method: "POST", body: form });
const json = JSON.parse(upload.text);
check("image uploaded", upload.status === 200 && json.ok, upload.text);
check("resized to 2000px wide", json.width === 2000 && json.height === 1125, `${json.width}x${json.height}`);
check("stored as WebP with an ascii name", /\/anh-chup-man-hinh-[0-9a-f]{8}\.webp$/.test(json.url ?? ""), json.url);

res = await fetch(json.url);
check("image served", res.status === 200 && res.headers.get("content-type") === "image/webp", res.status);
check("image cached long-term", /immutable/.test(res.headers.get("cache-control") ?? ""));

const svg = new FormData();
svg.set("file", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
check("SVG refused", (await admin.req("/api/media", { method: "POST", body: svg })).status === 415);
const broken = new FormData();
broken.set("file", new File(["not an image"], "x.png", { type: "image/png" }));
check("broken file refused", (await admin.req("/api/media", { method: "POST", body: broken })).status === 422);

res = await fetch(`${CMS}/uploads/%2e%2e/%2e%2e/%2e%2e/package.json`);
check("path traversal refused", res.status === 404 || res.status === 400, res.status);

// Every admin page renders.
const post = await somePublishedPost();
for (const page of [
  "/admin",
  "/admin?status=published",
  "/admin/users",
  "/admin/users/new",
  "/admin/account",
  "/admin/settings",
  `/admin/posts/${post.id}?locale=vi`,
  `/admin/posts/${post.id}?locale=en`,
]) {
  const r = await admin.req(page);
  check(`renders ${page}`, r.status === 200 && !/"digest":"/.test(r.text), r.status);
}
const search = await admin.req(`/admin?q=${encodeURIComponent(post.title.split(" ").slice(0, 3).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d"))}`);
check("search ignores accents", search.text.includes(post.title));
