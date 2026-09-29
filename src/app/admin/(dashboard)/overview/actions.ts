"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getT } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { BRIEF_FIELDS, MAX_BRIEF_FIELD_CHARS, MAX_POSTS_PER_WEEK, type BriefField } from "@/lib/ai-brief";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

const SaveBriefInput = z.object({
  siteId: z.string().min(1).max(64),
  brief: z.object(
    // A part left out is "not filled in", like an empty one.
    Object.fromEntries(BRIEF_FIELDS.map((f) => [f, z.string().trim().max(MAX_BRIEF_FIELD_CHARS).optional()])) as Record<BriefField, z.ZodOptional<z.ZodString>>,
  ),
  postsPerWeek: z.number().int().min(1).max(MAX_POSTS_PER_WEEK).nullable(),
});

export type SaveBriefResult = { ok: true } | { ok: false; error: string };

/** Saves what the blog is for and the weekly target; the AI reads the brief from then on. */
export async function saveBrief(raw: z.input<typeof SaveBriefInput>): Promise<SaveBriefResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = SaveBriefInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.overview.errors.invalid };
  if (!can(user.role, "strategy.manage")) return { ok: false, error: t.overview.errors.noAccess };
  const input = parsed.data;

  const db = await getDb();
  // Blank parts are left out, so "not filled in" stays distinguishable from an empty answer.
  const brief = Object.fromEntries(BRIEF_FIELDS.filter((f) => input.brief[f]).map((f) => [f, input.brief[f]]));
  const [site] = await db
    .update(schema.sites)
    .set({ contentBrief: brief, postsPerWeek: input.postsPerWeek })
    .where(eq(schema.sites.id, input.siteId))
    .returning({ id: schema.sites.id, name: schema.sites.name });
  if (!site) return { ok: false, error: t.overview.errors.notFound };

  await logActivity({
    userId: user.id,
    action: "site.brief_updated",
    entityType: "site",
    entityId: site.id,
    siteId: site.id,
    meta: { name: site.name, postsPerWeek: input.postsPerWeek },
  });
  revalidatePath("/admin/overview");
  return { ok: true };
}
