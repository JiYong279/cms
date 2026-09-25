/**
 * Copies everything from the local PGlite database (.data/pglite) to the Postgres server in
 * DATABASE_URL, and moves the images that live on local disk to the configured image storage
 * (Vercel Blob or S3), rewriting their addresses in the articles.
 *
 *   DATABASE_URL=… BLOB_READ_WRITE_TOKEN=… npm run db:copy-to-postgres
 *
 * Stop `npm run dev` first: PGlite opens in one process at a time. The target is migrated first
 * and must not contain articles yet. Sessions and failed sign-ins are not copied: people sign in
 * again. For a dry run against another PGlite folder instead of Postgres, set TARGET_PGLITE_DIR.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { count, getTableName, type Table } from "drizzle-orm";
import type { Database } from "../src/db";
import * as schema from "../src/db/schema";
import { storeFile } from "../src/lib/storage";

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const SOURCE_DIR = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".data", "uploads");

/** In foreign-key order: every table comes after the tables it points to. */
const TABLES: Table[] = [
  schema.sites,
  schema.users,
  schema.categories,
  schema.posts,
  schema.postTranslations,
  schema.revisions,
  schema.media,
  schema.slugRedirects,
  schema.activityLog,
  schema.glossary,
];

async function openSource(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  return drizzle(new PGlite(SOURCE_DIR), { schema }) as unknown as Database;
}

async function openTarget(): Promise<{ db: Database; label: string; close: () => Promise<void> }> {
  const dir = process.env.TARGET_PGLITE_DIR;
  if (dir) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite(dir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Database, label: `PGlite ${dir}`, close: () => client.close() };
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Set DATABASE_URL (or TARGET_PGLITE_DIR for a dry run).");
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: url, max: 1, ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Database, label: new URL(url).host, close: () => pool.end() };
}

/** Local upload addresses as the CMS wrote them: http://localhost:3001/uploads/2026/09/x.webp or /uploads/… */
const LOCAL_UPLOAD = /(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)?\/uploads\/([\w\-./%]+\.(?:webp|gif|jpe?g|png|avif))/g;

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  avif: "image/avif",
};

/** Uploads each local image once and returns old address → new address. */
async function moveImages(texts: string[]): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const text of texts) for (const m of text.matchAll(LOCAL_UPLOAD)) keys.set(m[0], decodeURIComponent(m[1]));
  for (const [address, key] of keys) {
    const file = path.join(UPLOAD_DIR, ...key.split("/"));
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      console.warn(`  ! missing file for ${address}; left as it is`);
      continue;
    }
    const url = await storeFile(key, body, CONTENT_TYPES[key.split(".").pop()!.toLowerCase()] ?? "application/octet-stream");
    if (!url) throw new Error("No image storage configured: set BLOB_READ_WRITE_TOKEN (or S3_*) so images leave this computer.");
    moved.set(address, url);
    console.log(`  image ${key} → ${url}`);
  }
  return moved;
}

/** Replaces every moved address inside a value (strings, or JSON such as Tiptap documents). */
function rewrite<T>(value: T, moved: Map<string, string>): T {
  if (moved.size === 0 || value == null) return value;
  const replace = (s: string) => s.replace(LOCAL_UPLOAD, (m) => moved.get(m) ?? m);
  if (typeof value === "string") return replace(value) as T;
  if (typeof value === "object" && !(value instanceof Date)) return JSON.parse(replace(JSON.stringify(value))) as T;
  return value;
}

async function main() {
  const source = await openSource();
  const target = await openTarget();
  try {
    const [{ n: existing }] = await target.db.select({ n: count() }).from(schema.posts);
    if (existing > 0) throw new Error(`${target.label} already has ${existing} article(s); refusing to copy over them.`);

    const rows = new Map<Table, Record<string, unknown>[]>();
    for (const table of TABLES) rows.set(table, (await source.select().from(table)) as Record<string, unknown>[]);

    // Images first, so the copied rows already point at their new addresses.
    const texts = TABLES.flatMap((t) => rows.get(t)!.map((r) => JSON.stringify(r)));
    const moved = await moveImages(texts);

    await target.db.transaction(async (tx) => {
      // Sites may already exist in the target (e.g. created by db:seed): replace them with the local ones.
      await tx.delete(schema.sites);
      for (const table of TABLES) {
        const list = rows.get(table)!.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, rewrite(v, moved)])));
        for (let i = 0; i < list.length; i += 200) {
          if (list.length) await tx.insert(table).values(list.slice(i, i + 200));
        }
        console.log(`${getTableName(table).padEnd(18)} ${list.length} row(s)`);
      }
    });
    console.log(`Copied to ${target.label}; ${moved.size} image(s) moved.`);
  } finally {
    await target.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
