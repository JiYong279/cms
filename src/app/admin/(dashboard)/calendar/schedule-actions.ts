"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getT, getTimeZone } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { requireUser, type CurrentUser } from "@/lib/auth";
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

const ScheduleTimeInput = z.object({
  postId: z.uuid(),
  /** The day the versions are scheduled for now, as the calendar shows it. */
  from: z.iso.date(),
  /** The new moment, chosen in the viewer's browser. */
  at: z.iso.datetime(),
});

export type ScheduleTimeInput = z.input<typeof ScheduleTimeInput>;

/**
 * Moves an article's versions scheduled on day `from` to new moments (`next` gives each one its
 * new time). Only versions still to come move, from one future moment to another, so the website
 * shows nothing new and needs no notice. Published versions never move here; the date readers see
 * is changed in the editor ("Publication date").
 */
async function moveScheduled(
  user: CurrentUser,
  postId: string,
  from: string,
  next: (was: Date, timeZone: string) => Date,
): Promise<RescheduleResult> {
  const t = (await getT()).posts.errors;

  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
  if (!post) return { ok: false, error: t.notFound };
  if (post.deletedAt) return { ok: false, error: t.trashed };
  if (!canEditPost(user, post)) return { ok: false, error: t.notAllowedEdit };
  if (!can(user.role, "posts.publish")) return { ok: false, error: t.notAllowedReschedule };

  const timeZone = await getTimeZone();
  const translations = await db.select().from(schema.postTranslations).where(eq(schema.postTranslations.postId, post.id));
  const now = Date.now();
  const moving = translations.flatMap((tr) =>
    tr.status === "scheduled" && tr.scheduledAt && getDayKey(tr.scheduledAt, timeZone) === from
      ? [{ ...tr, was: tr.scheduledAt, at: next(tr.scheduledAt, timeZone) }]
      : [],
  );
  // Gone out meanwhile (a scheduled version whose time has passed is already on the website, even
  // before it is marked published), or changed by someone in the editor.
  if (moving.length === 0 || moving.some((tr) => tr.was.getTime() <= now)) return { ok: false, error: t.notScheduled };
  if (moving.every((tr) => tr.at.getTime() === tr.was.getTime())) return { ok: true };
  if (moving.some((tr) => tr.at.getTime() <= now)) return { ok: false, error: t.pastSchedule };

  await db.transaction(async (tx) => {
    for (const tr of moving) {
      await tx
        .update(schema.postTranslations)
        // Moving the date is not an edit of the article: keep "last updated" as it was.
        .set({ scheduledAt: tr.at, updatedAt: tr.updatedAt })
        .where(eq(schema.postTranslations.id, tr.id));
    }
  });

  const at = moving[0].at;
  await logActivity({
    userId: user.id,
    action: "post.rescheduled",
    entityType: "post",
    entityId: post.id,
    siteId: post.siteId,
    meta: {
      title: translations.find((tr) => tr.locale === "vi")?.title || translations[0]?.title || "",
      date: getDayKey(at, timeZone),
      time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at),
    },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/calendar");
  revalidatePath(`/admin/posts/${post.id}`);
  return { ok: true };
}

/** A scheduled card dragged to another day on the editorial calendar: same time of day, new day. */
export async function reschedulePost(raw: RescheduleInput): Promise<RescheduleResult> {
  const user = await requireUser();
  const parsed = RescheduleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: (await getT()).posts.errors.invalid };
  const { postId, from, to } = parsed.data;
  return moveScheduled(user, postId, from, (was, timeZone) => moveToDay(was, to, timeZone));
}

/** "Change publishing time" on a scheduled card: a new day and time for every version scheduled that day. */
export async function setScheduleTime(raw: ScheduleTimeInput): Promise<RescheduleResult> {
  const user = await requireUser();
  const parsed = ScheduleTimeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: (await getT()).posts.errors.invalid };
  const { postId, from, at } = parsed.data;
  return moveScheduled(user, postId, from, () => new Date(at));
}
