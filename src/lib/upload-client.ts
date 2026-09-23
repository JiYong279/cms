import type { UploadResponse } from "@/app/api/media/route";

export type UploadedImage = { url: string; width: number; height: number };

/**
 * Sends one image to the CMS and returns its public URL. Throws with the server's message on
 * failure, or with `networkError` (already translated by the caller) when the request fails.
 */
export async function uploadImage(
  file: File,
  { siteId, alt, networkError }: { siteId?: string; alt?: string; networkError: string },
) {
  const body = new FormData();
  body.set("file", file);
  if (siteId) body.set("siteId", siteId);
  if (alt) body.set("alt", alt);

  let result: UploadResponse;
  try {
    const res = await fetch("/api/media", { method: "POST", body });
    result = await res.json();
  } catch {
    throw new Error(networkError);
  }
  if (!result.ok) throw new Error(result.error);
  return { url: result.url, width: result.width, height: result.height } satisfies UploadedImage;
}

/** Image files from a paste or drop, ignoring text and other file types. */
export function imageFiles(list: FileList | null | undefined) {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}
