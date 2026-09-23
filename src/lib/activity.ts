import { and, desc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { dictionaries } from "@/i18n";
import { describeActivity } from "./activity-text";

export type ActivityInput = {
  userId: string | null;
  action: string;
  entityType: "post" | "user" | "site" | "auth";
  entityId?: string | null;
  siteId?: string | null;
  /** Stored Vietnamese fallback; derived from action + meta when omitted. */
  summary?: string;
  meta?: Record<string, unknown>;
};

/** Repeated saves of the same article by the same person within this window become one entry. */
const COALESCE_MS = 10 * 60_000;

/**
 * Records one line in the activity log. Never throws: a logging problem must not break the
 * action the user just performed.
 */
export async function logActivity(entry: ActivityInput) {
  const input = {
    ...entry,
    summary: entry.summary ?? describeActivity({ action: entry.action, summary: entry.action, meta: entry.meta ?? null }, dictionaries.vi),
  };
  try {
    const db = await getDb();
    if (input.action === "post.updated" && input.userId && input.entityId) {
      const [recent] = await db
        .select({ id: schema.activityLog.id, summary: schema.activityLog.summary })
        .from(schema.activityLog)
        .where(
          and(
            eq(schema.activityLog.action, "post.updated"),
            eq(schema.activityLog.entityType, input.entityType),
            eq(schema.activityLog.entityId, input.entityId),
            eq(schema.activityLog.userId, input.userId),
            gt(schema.activityLog.at, new Date(Date.now() - COALESCE_MS)),
          ),
        )
        .orderBy(desc(schema.activityLog.at))
        .limit(1);
      if (recent && recent.summary === input.summary) {
        await db.update(schema.activityLog).set({ at: new Date(), meta: input.meta }).where(eq(schema.activityLog.id, recent.id));
        return;
      }
    }
    await db.insert(schema.activityLog).values({
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      siteId: input.siteId ?? null,
      summary: input.summary,
      meta: input.meta,
    });
  } catch (error) {
    console.error("[activity] could not record", input.action, error);
  }
}

/** Kinds of entries the log can be filtered by (labels live in t.activity.groups). */
export const ACTIVITY_GROUPS = ["post", "user", "site", "auth"] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];
