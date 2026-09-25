import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { slugify } from "./posts";

/**
 * Where uploaded images go (hosts without a persistent disk, such as Vercel, need one of the first two):
 * - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (added by connecting a Blob store to the project).
 * - S3-compatible object storage (Cloudflare R2, AWS S3…) when S3_BUCKET is set, served from S3_PUBLIC_URL.
 * - Otherwise local disk (`.data/uploads`, or UPLOAD_DIR), served by /uploads/[...key].
 */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".data", "uploads");

const s3Config = process.env.S3_BUCKET
  ? {
      bucket: process.env.S3_BUCKET,
      publicUrl: (process.env.S3_PUBLIC_URL ?? "").replace(/\/$/, ""),
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    }
  : null;

/**
 * Stores a file under `key` and returns its public URL, or null when it stays on local disk
 * (the app then serves it under /uploads/<key>).
 */
export async function storeFile(key: string, body: Buffer, contentType: string): Promise<string | null> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    // Keys contain a random suffix and are never overwritten, so they can be cached for a year.
    const blob = await put(key, body, { access: "public", contentType, addRandomSuffix: false, cacheControlMaxAge: 31536000 });
    return blob.url;
  }
  if (!s3Config) {
    const file = path.join(UPLOAD_DIR, ...key.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    return null;
  }
  if (!s3Config.publicUrl) throw new Error("S3_PUBLIC_URL is required when S3_BUCKET is set");
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    credentials: { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Keys contain a random suffix and are never overwritten.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return `${s3Config.publicUrl}/${key}`;
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Wider images are scaled down; nobody reads a blog post on a 4000px-wide column. */
const MAX_WIDTH = 2000;

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
};

export function isAcceptedImage(mimeType: string) {
  return ACCEPTED.has(mimeType);
}

/** `url` is null when the file is served by this app under /uploads/<key>. */
export type SavedImage = { key: string; url: string | null; mimeType: string; size: number; width: number; height: number };

/** Normalises an uploaded image (orientation, size, WebP) and writes it to storage. */
export async function saveImage(input: Buffer, originalName: string, mimeType: string): Promise<SavedImage> {
  // Animated GIFs would lose their animation as WebP stills, so they are stored untouched.
  const keepAsIs = mimeType === "image/gif";
  const image = sharp(input, { animated: keepAsIs });
  const meta = await image.metadata();

  const output = keepAsIs
    ? input
    : await image
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
  const ext = keepAsIs ? ".gif" : ".webp";
  const outMeta = keepAsIs ? meta : await sharp(output).metadata();

  const now = new Date();
  const base = slugify(originalName.replace(/\.[^.]+$/, "")) || "anh";
  const key = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    `${base.slice(0, 50)}-${randomBytes(4).toString("hex")}${ext}`,
  ].join("/");

  const url = await storeFile(key, output, CONTENT_TYPES[ext]);

  return {
    key,
    url,
    mimeType: CONTENT_TYPES[ext],
    size: output.length,
    width: outMeta.width ?? 0,
    height: keepAsIs ? (meta.pageHeight ?? meta.height ?? 0) : (outMeta.height ?? 0),
  };
}

/** Reads a stored file, or null when the key is unknown or tries to escape the upload folder. */
export async function readUpload(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const file = path.resolve(UPLOAD_DIR, ...key.split("/"));
  if (!file.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return null;
  const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (!contentType) return null;
  try {
    return { body: await readFile(file), contentType };
  } catch {
    return null;
  }
}
