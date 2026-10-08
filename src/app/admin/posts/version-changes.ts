import { getFieldChanges, type FieldChange } from "@/lib/activity-changes";

/** An article version as the activity log compares it, before and after a save. */
export type VersionSnapshot = {
  title: string;
  excerpt: string;
  contentHtml: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  slug: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  noindex: boolean;
  coverImageAlt: string;
  /** Shared by every language of the article. */
  category: string | null;
  featured: boolean;
  pillar: boolean;
  coverImageUrl: string | null;
};

export function countWords(html: string) {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

/**
 * What a save changed in an article version, for the activity log. The body is compared as a
 * whole and recorded as its word count; the status is left out, the log line already says it.
 * A version written for the first time only records its length.
 */
export function getVersionChanges(before: VersionSnapshot | null, after: VersionSnapshot): FieldChange[] {
  const words = countWords(after.contentHtml);
  if (!before) return words ? [{ field: "content", from: null, to: words }] : [];
  const flat = (v: VersionSnapshot) => ({
    title: v.title,
    excerpt: v.excerpt,
    metaTitle: v.metaTitle,
    metaDescription: v.metaDescription,
    focusKeyword: v.focusKeyword,
    slug: v.slug,
    scheduledAt: v.scheduledAt?.toISOString() ?? null,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    noindex: v.noindex,
    coverImageAlt: v.coverImageAlt,
    category: v.category,
    featured: v.featured,
    pillar: v.pillar,
    coverImageUrl: v.coverImageUrl,
  });
  const changes = getFieldChanges(flat(before), flat(after));
  if (before.contentHtml !== after.contentHtml) {
    // Right after the title, where readers of the log look first.
    changes.splice(changes[0]?.field === "title" ? 1 : 0, 0, { field: "content", from: countWords(before.contentHtml), to: words });
  }
  return changes;
}
