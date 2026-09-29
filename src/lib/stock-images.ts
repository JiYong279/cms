/**
 * Free stock photos from Pexels (pexels.com/api): the Pexels licence allows commercial use without
 * attribution, and we credit the photographer anyway. Needs PEXELS_API_KEY; PEXELS_API_URL only
 * points the tests at a stand-in server.
 */

const API = (process.env.PEXELS_API_URL || "https://api.pexels.com/v1").replace(/\/$/, "");

export function stockImagesConfigured() {
  return !!process.env.PEXELS_API_KEY;
}

export type StockPhoto = {
  id: number;
  /** Small preview for the picker. */
  thumb: string;
  width: number;
  height: number;
  /** Pexels' own description, in English. */
  alt: string;
  photographer: string;
  pageUrl: string;
};

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  alt: string;
  photographer: string;
  src: { medium: string; large2x: string };
};

async function pexels(path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY ?? "" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`[stock] Pexels ${res.status} for ${path}`);
  return res.json();
}

const toPhoto = (p: PexelsPhoto): StockPhoto => ({
  id: p.id,
  thumb: p.src.medium,
  width: p.width,
  height: p.height,
  alt: p.alt ?? "",
  photographer: p.photographer,
  pageUrl: p.url,
});

/** Landscape photos for a query; Pexels understands Vietnamese queries with the vi-VN locale. */
export async function searchStockPhotos(query: string, locale: "vi" | "en"): Promise<StockPhoto[]> {
  const params = new URLSearchParams({ query, per_page: "12", orientation: "landscape", locale: locale === "vi" ? "vi-VN" : "en-US" });
  const data = (await pexels(`/search?${params}`)) as { photos?: PexelsPhoto[] };
  return (data.photos ?? []).map(toPhoto);
}

/** Only Pexels' image host (or the stand-in's, in tests): never fetch an address a browser sent. */
function isTrustedImageUrl(url: string) {
  try {
    const host = new URL(url).host;
    return host === "images.pexels.com" || (!!process.env.PEXELS_API_URL && host === new URL(API).host);
  } catch {
    return false;
  }
}

/** One photo by id, looked up again on the server, with the address to download it from. */
export async function getStockPhoto(id: number): Promise<{ photo: StockPhoto; download: string } | null> {
  const p = (await pexels(`/photos/${id}`)) as PexelsPhoto | undefined;
  if (!p?.src?.large2x || !isTrustedImageUrl(p.src.large2x)) return null;
  return { photo: toPhoto(p), download: p.src.large2x };
}
