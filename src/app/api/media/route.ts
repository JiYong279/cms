import { getDb, schema } from "@/db";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, StorageError, isAcceptedImage, saveImage, type SavedImage } from "@/lib/storage";

export type UploadResponse =
  | { ok: true; id: string; url: string; width: number; height: number }
  | { ok: false; error: string };

function fail(error: string, status: number) {
  return Response.json({ ok: false, error } satisfies UploadResponse, { status });
}

/** Absolute URL, since the HTML is rendered on other domains. Set CMS_PUBLIC_URL in production. */
function publicUrl(saved: SavedImage, request: Request) {
  if (saved.url) return saved.url;
  const origin = process.env.CMS_PUBLIC_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  return `${origin}/uploads/${saved.key}`;
}

export async function POST(request: Request) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return fail(t.editor.upload.sessionExpired, 401);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(t.editor.upload.noFile, 400);
  if (!isAcceptedImage(file.type)) return fail(t.editor.upload.badType, 415);
  if (file.size > MAX_UPLOAD_BYTES) return fail(t.editor.upload.tooLarge, 413);

  const siteId = form?.get("siteId");
  const alt = String(form?.get("alt") ?? "").slice(0, 300);

  let saved;
  try {
    saved = await saveImage(Buffer.from(await file.arrayBuffer()), file.name || "anh", file.type);
  } catch (error) {
    if (error instanceof StorageError) {
      console.error(error);
      return fail(t.editor.upload.storageFailed, 503);
    }
    return fail(t.editor.upload.unreadable, 422);
  }

  const url = publicUrl(saved, request);
  const db = await getDb();
  const [row] = await db
    .insert(schema.media)
    .values({
      siteId: typeof siteId === "string" && siteId ? siteId : null,
      url,
      storageKey: saved.key,
      filename: file.name || saved.key,
      mimeType: saved.mimeType,
      size: saved.size,
      alt,
      uploadedBy: user.id,
    })
    .returning({ id: schema.media.id });

  return Response.json({ ok: true, id: row.id, url, width: saved.width, height: saved.height } satisfies UploadResponse);
}
