import { and, count, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Activity-log actions that are each one paid AI run, counted against the daily cap. */
export const AI_ACTIONS = ["post.ai_drafted", "post.ai_translated", "post.ai_seo_fixed", "post.ai_planned", "post.ai_categorized", "category.ai_proposed"];
/** Each run costs money: a generous cap per person per day stops runaway use. */
export const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 30;

/** Paid AI runs by this person in the last 24 hours. */
export async function getAiRunsToday(userId: string) {
  const db = await getDb();
  const [{ used }] = await db
    .select({ used: count() })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.userId, userId),
        inArray(schema.activityLog.action, AI_ACTIONS),
        gt(schema.activityLog.at, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
    );
  return used;
}
