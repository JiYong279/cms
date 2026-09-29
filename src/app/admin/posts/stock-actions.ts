"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getStockPhoto, searchStockPhotos, stockImagesConfigured, type StockPhoto } from "@/lib/stock-images";
import { MAX_UPLOAD_BYTES, StorageError, isAcceptedImage, saveImage } from "@/lib/storage";

const SearchInput = z.object({ query: z.string().trim().min(2).max(200), locale: z.enum(["vi", "en"]) });

export type StockSearchResult = { ok: true; photos: StockPhoto[] } | { ok: false; error: string };

/** Free stock photos for a query (Pexels). */
export async function searchStock(raw: z.input<typeof SearchInput>): Promise<StockSearchResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = SearchInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.editor.stock.errors.query };
  if (!can(user.role, "posts.create")) return { ok: false, error: t.posts.errors.notAllowedEdit };
  if (!stockImagesConfigured()) return { ok: false, error: t.editor.stock.errors.notConfigured };
  try {
    return { ok: true, photos: await searchStockPhotos(parsed.data.query, parsed.data.locale) };
  } catch (error) {
    console.error("[stock] search failed:", error);
    return { ok: false, error: t.editor.stock.errors.unavailable };
  }
}

const ImportInput = z.object({ photoId: z.number().int().positive(), siteId: z.string().min(1).max(64) });

export type StockImportResult =
  | { ok: true; url: string; width: number; height: number; credit: string; alt: string }
  | { ok: false; error: string };

/**
 * Copies a stock photo into our own image storage (never hot-linked: a photo removed from Pexels
 * would vanish from the article), like an upload, crediting the photographer.
 */
export async function importStock(raw: z.input<typeof ImportInput>): Promise<StockImportResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = ImportInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.posts.errors.invalid };
  if (!can(user.role, "posts.create")) return { ok: false, error: t.posts.errors.notAllowedEdit };
  if (!stockImagesConfigured()) return { ok: false, error: t.editor.stock.errors.notConfigured };
  const db = await getDb();
  const [site] = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, parsed.data.siteId)).limit(1);
  if (!site) return { ok: false, error: t.posts.errors.invalid };

  let found: Awaited<ReturnType<typeof getStockPhoto>>;
  let body: Buffer;
  let mimeType: string;
  try {
    found = await getStockPhoto(parsed.data.photoId);
    if (!found) return { ok: false, error: t.editor.stock.errors.unavailable };
    const res = await fetch(found.download, { signal: AbortSignal.timeout(30_000) });
    mimeType = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!res.ok || !isAcceptedImage(mimeType)) return { ok: false, error: t.editor.stock.errors.unavailable };
    body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_UPLOAD_BYTES) return { ok: false, error: t.editor.upload.tooLarge };
  } catch (error) {
    console.error("[stock] download failed:", error);
    return { ok: false, error: t.editor.stock.errors.unavailable };
  }

  let saved;
  try {
    saved = await saveImage(body, `pexels-${found.photo.id}`, mimeType);
  } catch (error) {
    if (error instanceof StorageError) {
      console.error(error);
      return { ok: false, error: t.editor.upload.storageFailed };
    }
    throw error;
  }
  const h = await headers();
  const origin = process.env.CMS_PUBLIC_URL?.replace(/\/$/, "") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const url = saved.url ?? `${origin}/uploads/${saved.key}`;
  const credit = `${found.photo.photographer} / Pexels`;

  await db.insert(schema.media).values({
    siteId: parsed.data.siteId,
    url,
    storageKey: saved.key,
    filename: `pexels-${found.photo.id}`,
    mimeType: saved.mimeType,
    size: saved.size,
    alt: found.photo.alt,
    uploadedBy: user.id,
  });
  return { ok: true, url, width: saved.width, height: saved.height, credit, alt: found.photo.alt };
}
