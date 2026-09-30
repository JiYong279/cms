"use server";

import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { PostStatus } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { can, canDeletePost, canEditPost, canEditTranslation, isLive } from "@/lib/permissions";
import { countUnknownImages } from "@/lib/image-rights";
import { slugify } from "@/lib/posts";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import { notifySite } from "@/lib/revalidate";

export type SaveResult = { ok: true; savedAt: string; slug: string } | { ok: false; error: string };
export type BulkResult = { done: number; skipped: number };

function contentHash(title: string, excerpt: string, html: string) {
  return createHash("sha256").update(`${title}\n${excerpt}\n${html}`).digest("hex");
}

function readingMinutes(html: string) {
  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Postgres unique_violation, raised directly or wrapped by the driver. */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

/** What changed between two statuses, as an activity-log action (see lib/activity-text). */
function statusAction(before: PostStatus | null, after: PostStatus): string {
  if (after === before) return "post.updated";
  if (after === "published") return "post.published";
  if (after === "scheduled") return "post.scheduled";
  if (before && isLive(before)) return "post.unpublished";
  if (after === "in_review") return "post.submitted";
  if (!before) return "post.translated";
  return "post.status_changed";
}

async function postTitle(postId: string) {
  const db = await getDb();
  const rows = await db
    .select({ title: schema.postTranslations.title, locale: schema.postTranslations.locale })
    .from(schema.postTranslations)
    .where(eq(schema.postTranslations.postId, postId));
  return rows.find((r) => r.locale === "vi")?.title || rows[0]?.title || "";
}

export async function createPost(formData: FormData) {
  const user = await requireUser();
  if (!can(user.role, "posts.create")) throw new Error("Not allowed to create posts");
  const db = await getDb();

  const siteId = String(formData.get("siteId") ?? "");
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1);
  if (!site) throw new Error(`Unknown site: ${siteId}`);

  const [post] = await db.insert(schema.posts).values({ siteId, authorId: user.id }).returning();
  await db.insert(schema.postTranslations).values({
    postId: post.id,
    siteId,
    locale: site.defaultLocale,
    // Placeholder until the first save derives a slug from the title.
    slug: `bai-viet-${post.id.slice(0, 8)}`,
    updatedBy: user.id,
  });
  await logActivity({
    userId: user.id,
    action: "post.created",
    entityType: "post",
    entityId: post.id,
    siteId,
    summary: `Tạo bài mới cho ${site.name}`,
  });

  revalidatePath("/admin");
  redirect(`/admin/posts/${post.id}?locale=${site.defaultLocale}`);
}

const SaveInput = z.object({
  postId: z.uuid(),
  locale: z.enum(schema.localeEnum.enumValues),
  status: z.enum(schema.statusEnum.enumValues),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(80),
  excerpt: z.string().trim().max(500),
  contentJson: z.unknown(),
  contentHtml: z.string(),
  metaTitle: z.string().trim().max(200),
  metaDescription: z.string().trim().max(500),
  focusKeyword: z.string().trim().max(100),
  noindex: z.boolean(),
  scheduledAt: z.iso.datetime().nullable(),
  /** The date shown on the article and used to order the blog; empty means "when first published". */
  publishedAt: z.iso.datetime().nullable().optional(),
  categoryId: z.uuid().nullable(),
  featured: z.boolean(),
  /** The overview article of its topic; left out, the saved choice stays. */
  pillar: z.boolean().optional(),
  coverImageUrl: z.url().nullable().or(z.literal("").transform(() => null)),
  /** How many images the editor confirmed may be used in this save (they arrive as "permitted"). */
  imagesConfirmed: z.number().int().min(0).max(500).optional(),
  /** This language's description of the cover image; left out, the saved one stays. */
  coverImageAlt: z.string().trim().max(300).optional(),
  /** Set when this content was just translated from that locale (the editor's AI translation). */
  translatedFrom: z.enum(schema.localeEnum.enumValues).nullable().optional(),
});

export type SaveInput = z.input<typeof SaveInput>;

export async function savePost(raw: SaveInput): Promise<SaveResult> {
  const user = await requireUser();
  const t = (await getT()).posts.errors;
  const parsed = SaveInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.path[0] === "title" ? t.titleRequired : t.invalid };
  }
  const input = parsed.data;

  if (input.status === "scheduled" && !input.scheduledAt) {
    return { ok: false, error: t.scheduleNeedsDate };
  }

  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, input.postId)).limit(1);
  if (!post) return { ok: false, error: t.notFound };
  if (post.deletedAt) return { ok: false, error: t.trashed };
  if (!canEditPost(user, post)) return { ok: false, error: t.notAllowedEdit };

  const [existing] = await db
    .select()
    .from(schema.postTranslations)
    .where(and(eq(schema.postTranslations.postId, post.id), eq(schema.postTranslations.locale, input.locale)))
    .limit(1);

  if (!canEditTranslation(user, existing?.status ?? null)) {
    return { ok: false, error: t.liveLocked };
  }
  if (isLive(input.status) && !can(user.role, "posts.publish")) {
    return { ok: false, error: t.notAllowedPublish };
  }
  // An image nobody knows may be used never reaches the website.
  const unknownImages = countUnknownImages(input.contentHtml);
  if (isLive(input.status) && unknownImages > 0) {
    return { ok: false, error: fmt(t.unknownImages, { n: unknownImages }) };
  }

  const slug = slugify(input.slug || input.title);
  if (!slug) return { ok: false, error: t.badSlug };

  const [translatedFrom] =
    input.translatedFrom && input.translatedFrom !== input.locale
      ? await db
          .select({ locale: schema.postTranslations.locale, contentHash: schema.postTranslations.contentHash })
          .from(schema.postTranslations)
          .where(and(eq(schema.postTranslations.postId, post.id), eq(schema.postTranslations.locale, input.translatedFrom)))
          .limit(1)
      : [];

  const values = {
    status: input.status,
    title: input.title,
    slug,
    excerpt: input.excerpt,
    contentJson: input.contentJson,
    // TODO: sanitize on the server before websites render this HTML.
    contentHtml: input.contentHtml,
    readingMinutes: readingMinutes(input.contentHtml),
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    focusKeyword: input.focusKeyword,
    noindex: input.noindex,
    coverImageAlt: input.coverImageAlt ?? existing?.coverImageAlt ?? "",
    contentHash: contentHash(input.title, input.excerpt, input.contentHtml),
    scheduledAt: input.status === "scheduled" ? new Date(input.scheduledAt!) : null,
    // Only people who may publish can change the date readers see.
    publishedAt:
      input.publishedAt && can(user.role, "posts.publish")
        ? new Date(input.publishedAt)
        : input.status === "published"
          ? (existing?.publishedAt ?? new Date())
          : (existing?.publishedAt ?? null),
    updatedBy: user.id,
    // Remember the source version as it is now, so a later change to it marks this one stale.
    ...(translatedFrom ? { translatedFromLocale: translatedFrom.locale, translatedFromHash: translatedFrom.contentHash } : {}),
  };

  try {
    await db.transaction(async (tx) => {
      const [translation] = existing
        ? await tx
            .update(schema.postTranslations)
            .set(values)
            .where(eq(schema.postTranslations.id, existing.id))
            .returning()
        : await tx
            .insert(schema.postTranslations)
            .values({ ...values, postId: post.id, siteId: post.siteId, locale: input.locale })
            .returning();

      // The new slug may have been an old address of some article; it is taken now.
      await tx
        .delete(schema.slugRedirects)
        .where(
          and(
            eq(schema.slugRedirects.siteId, post.siteId),
            eq(schema.slugRedirects.locale, input.locale),
            eq(schema.slugRedirects.fromSlug, slug),
          ),
        );
      // Keep the old address of an article readers may have seen, so links to it still work.
      if (existing && existing.slug !== slug && existing.publishedAt) {
        await tx
          .insert(schema.slugRedirects)
          .values({ siteId: post.siteId, locale: input.locale, fromSlug: existing.slug, translationId: translation.id })
          .onConflictDoUpdate({
            target: [schema.slugRedirects.siteId, schema.slugRedirects.locale, schema.slugRedirects.fromSlug],
            set: { translationId: translation.id },
          });
      }

      await tx.insert(schema.revisions).values({
        translationId: translation.id,
        title: translation.title,
        excerpt: translation.excerpt,
        contentJson: translation.contentJson,
        createdBy: user.id,
      });

      await tx
        .update(schema.posts)
        .set({ categoryId: input.categoryId, featured: input.featured, pillar: input.pillar, coverImageUrl: input.coverImageUrl })
        .where(eq(schema.posts.id, post.id));
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: fmt(t.slugTaken, { slug }) };
    }
    throw error;
  }

  await logActivity({
    userId: user.id,
    action: statusAction(existing?.status ?? null, input.status),
    entityType: "post",
    entityId: post.id,
    siteId: post.siteId,
    meta: {
      title: input.title,
      locale: input.locale,
      status: input.status,
      ...(existing && existing.slug !== slug ? { slugFrom: existing.slug, slugTo: slug } : {}),
    },
  });

  if (input.imagesConfirmed && can(user.role, "posts.publish")) {
    await logActivity({
      userId: user.id,
      action: "post.images_confirmed",
      entityType: "post",
      entityId: post.id,
      siteId: post.siteId,
      meta: { title: input.title, locale: input.locale, n: input.imagesConfirmed },
    });
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/posts/${post.id}`);
  // The website only cares when something visible changed: a live article, or one taken down.
  if (isLive(input.status) || (existing && isLive(existing.status))) {
    notifySite(post.siteId, { [input.locale]: [...new Set([slug, existing?.slug].filter((s) => !!s))] as string[] });
  }
  return { ok: true, savedAt: new Date().toISOString(), slug };
}

/* ---------------- Trash ---------------- */

async function loadForDelete(ids: string[]) {
  const db = await getDb();
  const posts = ids.length ? await db.select().from(schema.posts).where(inArray(schema.posts.id, ids)) : [];
  const translations = ids.length
    ? await db
        .select({
          postId: schema.postTranslations.postId,
          status: schema.postTranslations.status,
          locale: schema.postTranslations.locale,
          slug: schema.postTranslations.slug,
          title: schema.postTranslations.title,
        })
        .from(schema.postTranslations)
        .where(inArray(schema.postTranslations.postId, ids))
    : [];
  return posts.map((post) => {
    const own = translations.filter((t) => t.postId === post.id);
    return { post, translations: own, title: own.find((t) => t.locale === "vi")?.title || own[0]?.title || "" };
  });
}

/** Tells each website that the live articles among these left or came back. */
function notifyLive(items: Awaited<ReturnType<typeof loadForDelete>>) {
  const bySite = new Map<string, { vi: string[]; en: string[] }>();
  for (const { post, translations } of items) {
    for (const t of translations.filter((t) => isLive(t.status))) {
      const slugs = bySite.get(post.siteId) ?? { vi: [], en: [] };
      slugs[t.locale].push(t.slug);
      bySite.set(post.siteId, slugs);
    }
  }
  for (const [siteId, slugs] of bySite) notifySite(siteId, slugs);
}

const Ids = z.array(z.uuid()).min(1).max(200);

async function trash(user: CurrentUser, ids: string[]): Promise<BulkResult> {
  const items = (await loadForDelete(ids)).filter(({ post }) => !post.deletedAt);
  const allowed = items.filter(({ post, translations }) => canDeletePost(user, post, translations.map((t) => t.status)));
  if (allowed.length) {
    const db = await getDb();
    await db
      .update(schema.posts)
      .set({ deletedAt: new Date(), deletedBy: user.id })
      .where(inArray(schema.posts.id, allowed.map((a) => a.post.id)));
    for (const { post, title } of allowed) {
      await logActivity({
        userId: user.id,
        action: "post.trashed",
        entityType: "post",
        entityId: post.id,
        siteId: post.siteId,
        meta: { title },
      });
    }
    notifyLive(allowed);
  }
  revalidatePath("/admin");
  return { done: allowed.length, skipped: ids.length - allowed.length };
}

/** Moves articles to the trash: hidden from the websites and the list, restorable for 30 days. */
export async function trashPosts(rawIds: string[]): Promise<BulkResult> {
  const user = await requireUser();
  const ids = Ids.parse(rawIds);
  return trash(user, ids);
}

/** From the editor: move this article to the trash and go back to the list. */
export async function trashPostAndLeave(postId: string) {
  const user = await requireUser();
  await trash(user, Ids.parse([postId]));
  redirect("/admin");
}

export async function restorePosts(rawIds: string[]): Promise<BulkResult> {
  const user = await requireUser();
  const ids = Ids.parse(rawIds);
  const items = (await loadForDelete(ids)).filter(({ post }) => post.deletedAt);
  const allowed = items.filter(({ post, translations }) => canDeletePost(user, post, translations.map((t) => t.status)));
  if (allowed.length) {
    const db = await getDb();
    await db
      .update(schema.posts)
      .set({ deletedAt: null, deletedBy: null })
      .where(inArray(schema.posts.id, allowed.map((a) => a.post.id)));
    for (const { post, title } of allowed) {
      await logActivity({
        userId: user.id,
        action: "post.restored",
        entityType: "post",
        entityId: post.id,
        siteId: post.siteId,
        meta: { title },
      });
    }
    notifyLive(allowed);
  }
  revalidatePath("/admin");
  return { done: allowed.length, skipped: ids.length - allowed.length };
}

/** Deletes trashed articles for good, with every translation and revision. Editors and admins only. */
export async function deletePostsForever(rawIds: string[]): Promise<BulkResult> {
  const user = await requireUser();
  const ids = Ids.parse(rawIds);
  if (!can(user.role, "posts.deleteAny")) return { done: 0, skipped: ids.length };
  const items = (await loadForDelete(ids)).filter(({ post }) => post.deletedAt);
  if (items.length) {
    const db = await getDb();
    await db.delete(schema.posts).where(inArray(schema.posts.id, items.map((i) => i.post.id)));
    for (const { post, title } of items) {
      await logActivity({
        userId: user.id,
        action: "post.deleted",
        entityType: "post",
        entityId: post.id,
        siteId: post.siteId,
        meta: { title },
      });
    }
  }
  revalidatePath("/admin");
  return { done: items.length, skipped: ids.length - items.length };
}

/** Records that a translation has been brought up to date with its source language. */
export async function markTranslationSynced(postId: string, locale: string) {
  const user = await requireUser();
  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
  if (!post || !canEditPost(user, post)) return;

  const translations = await db
    .select()
    .from(schema.postTranslations)
    .where(eq(schema.postTranslations.postId, postId));

  const target = translations.find((t) => t.locale === locale);
  const source = translations.find((t) => t.locale === target?.translatedFromLocale);
  if (!target || !source) return;

  await db
    .update(schema.postTranslations)
    .set({ translatedFromHash: source.contentHash })
    .where(eq(schema.postTranslations.id, target.id));
  await logActivity({
    userId: user.id,
    action: "post.synced",
    entityType: "post",
    entityId: postId,
    siteId: post.siteId,
    meta: { title: await postTitle(postId), locale: target.locale, source: source.locale },
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/posts/${postId}`);
}
