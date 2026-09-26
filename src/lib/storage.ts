import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { slugify } from "./posts";

/**
 * Where uploaded images go:
 * - S3-compatible object storage (DigitalOcean Spaces, MinIO, Cloudflare R2, AWS S3…) when S3_BUCKET
 *   is set, served from S3_PUBLIC_URL. See .env.example for each provider.
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
      // MinIO serves buckets under the path (host/bucket/key) rather than as a subdomain.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      // DigitalOcean Spaces keeps new files private unless they are uploaded as "public-read".
      acl: (process.env.S3_ACL || undefined) as "public-read" | undefined,
      // A folder inside the bucket, for a bucket shared with other apps (e.g. "cms").
      prefix: (process.env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, ""),
    }
  : null;

let s3Client: import("@aws-sdk/client-s3").S3Client | undefined;

/**
 * Stores a file under `key` and returns its public URL, or null when it stays on local disk
 * (the app then serves it under /uploads/<key>).
 */
export async function storeFile(key: string, body: Buffer, contentType: string): Promise<string | null> {
  if (s3Config) return storeInS3(s3Config, key, body, contentType);
  const file = path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, ...key.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return null;
}

async function storeInS3(config: NonNullable<typeof s3Config>, key: string, body: Buffer, contentType: string) {
  if (!config.publicUrl) throw new Error("S3_PUBLIC_URL is required when S3_BUCKET is set");
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  s3Client ??= new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const objectKey = config.prefix ? `${config.prefix}/${key}` : key;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      ACL: config.acl,
      // Keys contain a random suffix and are never overwritten.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return `${config.publicUrl}/${objectKey}`;
}

/** The image was fine but the storage (S3, disk) refused it or could not be reached. */
export class StorageError extends Error {
  constructor(cause: unknown) {
    super(`Image storage failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "StorageError";
  }
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

  const url = await storeFile(key, output, CONTENT_TYPES[ext]).catch((error: unknown) => {
    throw new StorageError(error);
  });

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
  const file = path.resolve(/*turbopackIgnore: true*/ UPLOAD_DIR, ...key.split("/"));
  if (!file.startsWith(path.resolve(/*turbopackIgnore: true*/ UPLOAD_DIR) + path.sep)) return null;
  const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (!contentType) return null;
  try {
    return { body: await readFile(file), contentType };
  } catch {
    return null;
  }
}
