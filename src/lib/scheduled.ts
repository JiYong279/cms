import { and, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logActivity } from "./activity";
import { notifySite } from "./revalidate";

// Checked on busy paths (public API, post list), so do the work at most this often per process.
const MIN_INTERVAL_MS = 30_000;
const TRASH_DAYS = 30;
const ACTIVITY_DAYS = 365;
let lastRun = 0;

/**
 * Turns scheduled translations whose time has come into published ones and tells their
 * websites; also empties old trash. Called lazily from busy paths and by
 * /api/cron/publish-scheduled.
 */
export async function publishDuePosts({ force = false } = {}) {
  if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) return [];
  lastRun = Date.now();

  const db = await getDb();
  const livePosts = db.select({ id: schema.posts.id }).from(schema.posts).where(isNull(schema.posts.deletedAt));
  const due = await db
    .update(schema.postTranslations)
    .set({
      status: "published",
      publishedAt: sql`coalesce(${schema.postTranslations.publishedAt}, ${schema.postTranslations.scheduledAt})`,
    })
    .where(
      and(
        eq(schema.postTranslations.status, "scheduled"),
        lte(schema.postTranslations.scheduledAt, new Date()),
        inArray(schema.postTranslations.postId, livePosts),
      ),
    )
    .returning({
      postId: schema.postTranslations.postId,
      siteId: schema.postTranslations.siteId,
      locale: schema.postTranslations.locale,
      slug: schema.postTranslations.slug,
      title: schema.postTranslations.title,
    });

  for (const d of due) {
    await logActivity({
      userId: null,
      action: "post.auto_published",
      entityType: "post",
      entityId: d.postId,
      siteId: d.siteId,
      meta: { title: d.title, locale: d.locale },
    });
  }
  for (const siteId of new Set(due.map((d) => d.siteId))) {
    const mine = due.filter((d) => d.siteId === siteId);
    notifySite(siteId, {
      vi: mine.filter((d) => d.locale === "vi").map((d) => d.slug),
      en: mine.filter((d) => d.locale === "en").map((d) => d.slug),
    });
  }

  await emptyOldTrash();
  return due;
}

/** Permanently removes articles that have sat in the trash for more than 30 days, and old log lines. */
async function emptyOldTrash() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000);
  const purged = await db
    .delete(schema.posts)
    .where(and(isNotNull(schema.posts.deletedAt), lt(schema.posts.deletedAt, cutoff)))
    .returning({ id: schema.posts.id, siteId: schema.posts.siteId });
  for (const p of purged) {
    await logActivity({
      userId: null,
      action: "post.purged",
      entityType: "post",
      entityId: p.id,
      siteId: p.siteId,
      meta: { days: TRASH_DAYS },
    });
  }
  await db.delete(schema.activityLog).where(lt(schema.activityLog.at, new Date(Date.now() - ACTIVITY_DAYS * 86_400_000)));
}
