import type { Locale, PostStatus, PostTranslation } from "@/db/schema";

export const LOCALES: Locale[] = ["vi", "en"];

export const LOCALE_LABEL: Record<Locale, string> = { vi: "Tiếng Việt", en: "English" };

export const STATUS: Record<PostStatus, { label: string; className: string }> = {
  draft: { label: "Nháp", className: "bg-zinc-100 text-zinc-600" },
  in_review: { label: "Chờ duyệt", className: "bg-amber-100 text-amber-700" },
  scheduled: { label: "Hẹn giờ", className: "bg-sky-100 text-sky-700" },
  published: { label: "Đã xuất bản", className: "bg-emerald-100 text-emerald-700" },
  archived: { label: "Lưu trữ", className: "bg-zinc-100 text-zinc-400" },
};

type HashFields = Pick<PostTranslation, "locale" | "contentHash" | "translatedFromLocale" | "translatedFromHash">;

/** A translation is stale when its source language changed after it was translated. */
export function isStale(translation: HashFields, all: HashFields[]) {
  if (!translation.translatedFromLocale) return false;
  const source = all.find((t) => t.locale === translation.translatedFromLocale);
  return !!source && source.contentHash !== translation.translatedFromHash;
}

/** "Cách mời đồng tác giả" → "cach-moi-dong-tac-gia" */
export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Where to open an article to look at it. When the CMS feeds a local copy of the website (its
 * revalidate URL is on localhost), that copy; otherwise the public address. Links shown as the
 * article's address (slug, search preview) keep using `baseUrl`.
 */
export function viewOrigin(site: { baseUrl: string; revalidateUrl: string | null }) {
  try {
    const target = site.revalidateUrl ? new URL(site.revalidateUrl) : null;
    if (target && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) return target.origin;
  } catch {
    // An invalid revalidate URL: fall back to the public address.
  }
  return site.baseUrl.replace(/\/$/, "");
}
