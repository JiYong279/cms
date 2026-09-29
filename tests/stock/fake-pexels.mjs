// A stand-in for the Pexels API, so free stock photos can be tested without a key. Start the CMS with
// PEXELS_API_KEY=fake PEXELS_API_URL=http://localhost:3998/v1 to use it. Photos are served by this
// server too (the CMS only downloads from Pexels' image host, or from the stand-in's in tests).
import http from "node:http";
import { createRequire } from "node:module";

const sharp = createRequire(import.meta.url)("sharp");
export const FAKE_PEXELS_PORT = Number(process.env.FAKE_PEXELS_PORT ?? 3998);
const base = `http://localhost:${FAKE_PEXELS_PORT}`;

/** Requests received, newest last. */
export const requests = [];

const photo = (id) => ({
  id,
  width: 1600,
  height: 1067,
  url: `https://www.pexels.com/photo/${id}/`,
  alt: `Clinic receptionist ${id}`,
  photographer: `Nhiếp ảnh gia ${id}`,
  src: { medium: `${base}/img/${id}.png`, large2x: `${base}/img/${id}.png` },
});

export function startFakePexels() {
  const server = http.createServer(async (req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    const url = new URL(req.url, base);
    if (url.pathname.startsWith("/img/")) {
      const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#16a260" } }).png().toBuffer();
      res.writeHead(200, { "content-type": "image/png" }).end(png);
      return;
    }
    if (req.headers.authorization !== "fake") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "bad key" }));
      return;
    }
    if (url.pathname === "/v1/search") {
      const photos = url.searchParams.get("query")?.includes("không có") ? [] : [101, 102, 103].map(photo);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ photos }));
      return;
    }
    const one = url.pathname.match(/^\/v1\/photos\/(\d+)$/);
    if (one) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(photo(Number(one[1]))));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(FAKE_PEXELS_PORT, () => resolve(server)));
}
