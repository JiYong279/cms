// Uploads a real image through saveImage() to the S3 storage in the environment (e.g. local Silo/MinIO,
// see docker-compose.minio.yml) and reads it back from its public address.
//   S3_BUCKET=cms S3_ENDPOINT=http://localhost:9000 … npx tsx tests/storage-s3.test.ts
import sharp from "sharp";
import { saveImage } from "../src/lib/storage";

async function main() {
  if (!process.env.S3_BUCKET) throw new Error("Set the S3_* variables first (see .env.example)");
  const png = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#0a6b45" } }).png().toBuffer();
  const saved = await saveImage(png, "Ảnh thử Silo.png", "image/png");
  console.log("stored:", saved.url, `${saved.width}x${saved.height}`, `${saved.size} bytes`);
  const res = await fetch(saved.url!);
  const ok = res.ok && res.headers.get("content-type") === "image/webp" && Number(res.headers.get("content-length")) === saved.size;
  console.log(`${ok ? "PASS" : "FAIL"}  public URL serves the image (${res.status}, ${res.headers.get("content-type")}, cache-control: ${res.headers.get("cache-control")})`);
  process.exitCode = ok ? 0 : 1;
}

main();
