"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getT, getTimeZone } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { getDayKey, moveToDay } from "@/lib/days";
import { can, canEditPost } from "@/lib/permissions";

export type RescheduleResult = { ok: true } | { ok: false; error: string };

const RescheduleInput = z.object({
  postId: z.uuid(),
  /** The day the versions are scheduled for now, as the calendar shows it. */
  from: z.iso.date(),
  to: z.iso.date(),
});

export type RescheduleInput = z.input<typeof RescheduleInput>;

/**
 * Moves an article's versions scheduled on one day to another day, keeping their time of day: a
 * scheduled card dragged on the editorial calendar. Published versions never move here; the date
 * readers see is changed in the editor ("Publication date").
 */
export async function reschedulePost(raw: RescheduleInput): Promise<RescheduleResult> {
  const user = await requireUser();
  const t = (await getT()).posts.errors;
  const parsed = RescheduleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.invalid };
  const input = parsed.data;

  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, input.postId)).limit(1);
  if (!post) return { ok: false, error: t.notFound };
  if (post.deletedAt) return { ok: false, error: t.trashed };
  if (!canEditPost(user, post)) return { ok: false, error: t.notAllowedEdit };
  if (!can(user.role, "posts.publish")) return { ok: false, error: t.notAllowedReschedule };

  const timeZone = await getTimeZone();
  const translations = await db.select().from(schema.postTranslations).where(eq(schema.postTranslations.postId, post.id));
  const now = Date.now();
  const moving = translations.flatMap((tr) =>
    tr.status === "scheduled" && tr.scheduledAt && getDayKey(tr.scheduledAt, timeZone) === input.from
      ? [{ ...tr, was: tr.scheduledAt, at: moveToDay(tr.scheduledAt, input.to, timeZone) }]
      : [],
  );
  // Gone out meanwhile (a scheduled version whose time has passed is already on the website, even
  // before it is marked published), or changed by someone in the editor.
  if (moving.length === 0 || moving.some((tr) => tr.was.getTime() <= now)) return { ok: false, error: t.notScheduled };
  if (input.to === input.from) return { ok: true };
  if (moving.some((tr) => tr.at.getTime() <= now)) return { ok: false, error: t.pastSchedule };

  await db.transaction(async (tx) => {
    for (const tr of moving) {
      await tx
        .update(schema.postTranslations)
        // Moving the day is not an edit of the article: keep "last updated" as it was.
        .set({ scheduledAt: tr.at, updatedAt: tr.updatedAt })
        .where(eq(schema.postTranslations.id, tr.id));
    }
  });

  await logActivity({
    userId: user.id,
    action: "post.rescheduled",
    entityType: "post",
    entityId: post.id,
    siteId: post.siteId,
    meta: { title: translations.find((tr) => tr.locale === "vi")?.title || translations[0]?.title || "", date: input.to },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/calendar");
  revalidatePath(`/admin/posts/${post.id}`);
  // Only versions still to come move, from one future moment to another: the website shows nothing new.
  return { ok: true };
}
