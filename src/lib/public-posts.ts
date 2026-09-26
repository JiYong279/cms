import { and, eq, inArray } from "drizzle-orm";
import type { JSONContent } from "@tiptap/react";
import { getDb, schema } from "@/db";
import type { Locale, PostTranslation } from "@/db/schema";
import { categoryName, categorySlug } from "./categories";
import { slugify } from "./posts";
import { publishDuePosts } from "./scheduled";

/**
 * The read-only view of published articles that websites consume. Everything here is
 * already public on the website, so no key is required.
 */

export type PublicPostSummary = {
  id: string;
  locale: Locale;
  slug: string;
  title: string;
  excerpt: string;
  category: { id: string; name: string; slug: string } | null;
  featured: boolean;
  coverImageUrl: string | null;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  /** Slug of the same article in each language that is live, for the language switcher. */
  alternates: Partial<Record<Locale, string>>;
};

export type PublicPost = PublicPostSummary & {
  metaTitle: string;
  metaDescription: string;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noindex: boolean;
  /** Tiptap document; every level-2 heading carries `attrs.id`, matching `toc`. */
  content: JSONContent;
  html: string;
  toc: { id: string; title: string }[];
  /** The writer, when they filled in an author profile for this language; otherwise null. */
  author: { name: string; jobTitle: string; bio: string } | null;
};

/** Only people who filled in an author profile in this language are named on the website. */
function publicAuthor(user: { name: string; jobTitles: Partial<Record<Locale, string>>; bios: Partial<Record<Locale, string>> } | null, locale: Locale) {
  const jobTitle = user?.jobTitles[locale]?.trim() ?? "";
  const bio = user?.bios[locale]?.trim() ?? "";
  return user && (jobTitle || bio) ? { name: user.name, jobTitle, bio } : null;
}

/** Published now, or scheduled for a moment that has passed. */
function isLive(t: Pick<PostTranslation, "status" | "scheduledAt">, now: Date) {
  return t.status === "published" || (t.status === "scheduled" && !!t.scheduledAt && t.scheduledAt <= now);
}

function liveDate(t: Pick<PostTranslation, "status" | "scheduledAt" | "publishedAt" | "updatedAt">) {
  return (t.status === "scheduled" ? t.scheduledAt : t.publishedAt) ?? t.updatedAt;
}

function nodeText(node: JSONContent): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

/** Gives each H2 a stable id derived from its text and returns the table of contents. */
function withHeadingIds(doc: JSONContent | null) {
  const toc: { id: string; title: string }[] = [];
  const used = new Map<string, number>();
  const content = (doc?.content ?? []).map((node) => {
    if (node.type !== "heading" || node.attrs?.level !== 2) return node;
    const title = nodeText(node).trim();
    const base = slugify(title) || "muc";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    toc.push({ id, title });
    return { ...node, attrs: { ...node.attrs, id } };
  });
  return { content: { type: "doc", content } satisfies JSONContent, toc };
}

async function loadLive(siteId: string, locale: Locale, slug?: string) {
  await publishDuePosts();
  const db = await getDb();
  const now = new Date();
  const rows = await db.query.postTranslations.findMany({
    where: (t, { and, eq, inArray }) =>
      and(
        eq(t.siteId, siteId),
        eq(t.locale, locale),
        inArray(t.status, ["published", "scheduled"]),
        slug ? eq(t.slug, slug) : undefined,
      ),
    with: { post: { with: { category: true, author: { columns: { name: true, jobTitles: true, bios: true } } } } },
  });
  // Trashed articles disappear from the websites until restored.
  const live = rows.filter((t) => isLive(t, now) && !t.post.deletedAt);
  if (live.length === 0) return [];

  // Alternate-language slugs, only for translations that are live too.
  const others = await db
    .select({
      postId: schema.postTranslations.postId,
      locale: schema.postTranslations.locale,
      slug: schema.postTranslations.slug,
      status: schema.postTranslations.status,
      scheduledAt: schema.postTranslations.scheduledAt,
    })
    .from(schema.postTranslations)
    .where(
      and(
        inArray(
          schema.postTranslations.postId,
          live.map((t) => t.postId),
        ),
        inArray(schema.postTranslations.status, ["published", "scheduled"]),
      ),
    );

  return live.map((t) => {
    const alternates: Partial<Record<Locale, string>> = {};
    for (const o of others) if (o.postId === t.postId && isLive(o, now)) alternates[o.locale] = o.slug;
    return { t, alternates };
  });
}

function summary({ t, alternates }: Awaited<ReturnType<typeof loadLive>>[number]): PublicPostSummary {
  const category = t.post.category;
  return {
    id: t.postId,
    locale: t.locale,
    slug: t.slug,
    title: t.title,
    excerpt: t.excerpt,
    category: category
      ? { id: category.id, name: categoryName(category, t.locale), slug: categorySlug(category, t.locale) }
      : null,
    featured: t.post.featured,
    coverImageUrl: t.post.coverImageUrl,
    publishedAt: liveDate(t).toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    readingMinutes: t.readingMinutes,
    alternates,
  };
}

export async function listPublicPosts(siteId: string, locale: Locale): Promise<PublicPostSummary[]> {
  const rows = await loadLive(siteId, locale);
  return rows.map(summary).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function getPublicPost(siteId: string, locale: Locale, slug: string): Promise<PublicPost | null> {
  const [row] = await loadLive(siteId, locale, slug);
  if (!row) return null;
  const { t } = row;
  const { content, toc } = withHeadingIds(t.contentJson as JSONContent | null);
  return {
    ...summary(row),
    metaTitle: t.metaTitle || t.title,
    metaDescription: t.metaDescription || t.excerpt,
    ogImageUrl: t.ogImageUrl ?? t.post.coverImageUrl,
    canonicalUrl: t.canonicalUrl,
    noindex: t.noindex,
    content,
    html: t.contentHtml,
    author: publicAuthor(t.post.author, locale),
    toc,
  };
}

/** Where an article now lives if `slug` is one it used to be published under. */
export async function findMovedSlug(siteId: string, locale: Locale, slug: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      slug: schema.postTranslations.slug,
      status: schema.postTranslations.status,
      scheduledAt: schema.postTranslations.scheduledAt,
      deletedAt: schema.posts.deletedAt,
    })
    .from(schema.slugRedirects)
    .innerJoin(schema.postTranslations, eq(schema.postTranslations.id, schema.slugRedirects.translationId))
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTranslations.postId))
    .where(
      and(
        eq(schema.slugRedirects.siteId, siteId),
        eq(schema.slugRedirects.locale, locale),
        eq(schema.slugRedirects.fromSlug, slug),
      ),
    )
    .limit(1);
  return row && !row.deletedAt && isLive(row, new Date()) ? row.slug : null;
}

export async function siteExists(siteId: string) {
  const db = await getDb();
  const [site] = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1);
  return !!site;
}

export type PublicCategory = {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Published articles in this language. */
  posts: number;
  /** The category page's slug in each language, for the language switcher. */
  alternates: Partial<Record<Locale, string>>;
};

/** Every category of a website in `locale`, in the order set in the CMS. */
export async function listPublicCategories(siteId: string, locale: Locale): Promise<PublicCategory[]> {
  const db = await getDb();
  const [categories, live] = await Promise.all([
    db.query.categories.findMany({
      where: (c, { eq }) => eq(c.siteId, siteId),
      orderBy: (c, { asc }) => [asc(c.position), asc(c.createdAt)],
    }),
    listPublicPosts(siteId, locale),
  ]);
  return categories.map((c) => ({
    id: c.id,
    name: categoryName(c, locale),
    slug: categorySlug(c, locale),
    description: c.descriptions[locale] ?? "",
    posts: live.filter((p) => p.category?.id === c.id).length,
    alternates: Object.fromEntries(
      (schema.localeEnum.enumValues as readonly Locale[]).map((l) => [l, categorySlug(c, l)]),
    ) as Partial<Record<Locale, string>>,
  }));
}
