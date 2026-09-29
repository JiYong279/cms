import type { JSONContent } from "@tiptap/react";

/**
 * Whether an image in an article may be used, and who to credit. Images stored as `data-rights` and
 * `data-credit` on the <img> (Tiptap image attributes `rights` and `credit`). An image whose rights
 * are "unknown" cannot go live until an editor confirms it may be used.
 */
export const IMAGE_RIGHTS = ["own", "stock", "diagram", "legal", "permitted", "unknown"] as const;
export type ImageRights = (typeof IMAGE_RIGHTS)[number];

const UNKNOWN = /<img\b[^>]*\bdata-rights="unknown"[^>]*>/g;

/** Images still waiting for someone to confirm they may be used. */
export function countUnknownImages(html: string) {
  return html.match(UNKNOWN)?.length ?? 0;
}

/** The article with every "unknown" image confirmed as allowed (the editor's check at publishing). */
export function permitUnknownImages(doc: JSONContent | null): JSONContent | null {
  if (!doc) return doc;
  const attrs = doc.type === "image" && doc.attrs?.rights === "unknown" ? { ...doc.attrs, rights: "permitted" } : doc.attrs;
  return { ...doc, ...(attrs ? { attrs } : {}), ...(doc.content ? { content: doc.content.map((c) => permitUnknownImages(c)!) } : {}) };
}

export function permitUnknownImagesInHtml(html: string) {
  return html.replace(UNKNOWN, (img) => img.replace('data-rights="unknown"', 'data-rights="permitted"'));
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/**
 * A translation pasted back from a chat keeps the images but not their rights and credit: copies them
 * from the source version's image with the same address.
 */
export function carryImageCredits(html: string, sourceHtml: string) {
  const source = new Map<string, string>();
  for (const [tag] of sourceHtml.matchAll(/<img\b[^>]*>/g)) {
    const src = attr(tag, "src");
    const extra = ["data-rights", "data-credit"].map((n) => (attr(tag, n) !== undefined ? ` ${n}="${attr(tag, n)}"` : "")).join("");
    if (src && extra) source.set(src, extra);
  }
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const extra = source.get(attr(tag, "src") ?? "");
    return extra && !/\bdata-rights=/.test(tag) ? tag.replace(/<img\b/, `<img${extra}`) : tag;
  });
}
