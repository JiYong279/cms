"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getT } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { can, canEditPost } from "@/lib/permissions";

export type PlanResult = { ok: true } | { ok: false; error: string };

/** A field left out stays as it is; null clears it. */
const PlanInput = z.object({
  postId: z.uuid(),
  plannedFor: z.iso.date().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
});

export type PlanInput = z.input<typeof PlanInput>;

/**
 * Sets the day an article is planned for and who looks after it: the editorial calendar and the
 * editor's "Plan" section. Neither is visible on the website, so no website is notified.
 */
export async function planPost(raw: PlanInput): Promise<PlanResult> {
  const user = await requireUser();
  const t = (await getT()).posts.errors;
  const parsed = PlanInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.invalid };
  const input = parsed.data;

  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, input.postId)).limit(1);
  if (!post) return { ok: false, error: t.notFound };
  if (post.deletedAt) return { ok: false, error: t.trashed };
  if (!canEditPost(user, post)) return { ok: false, error: t.notAllowedEdit };

  let assignee: { id: string; name: string } | null = null;
  if (input.assigneeId !== undefined) {
    if (!can(user.role, "posts.assign")) return { ok: false, error: t.notAllowedAssign };
    if (input.assigneeId) {
      const [target] = await db.select().from(schema.users).where(eq(schema.users.id, input.assigneeId)).limit(1);
      // Looking after an article means opening it, which takes seeing everyone's articles.
      if (!target || !target.active || !can(target.role, "posts.editAny")) return { ok: false, error: t.badAssignee };
      assignee = { id: target.id, name: target.name };
    }
  }

  const plannedChanged = input.plannedFor !== undefined && input.plannedFor !== post.plannedFor;
  const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== post.assigneeId;
  if (!plannedChanged && !assigneeChanged) return { ok: true };

  await db
    .update(schema.posts)
    .set({
      ...(plannedChanged ? { plannedFor: input.plannedFor } : {}),
      ...(assigneeChanged ? { assigneeId: assignee?.id ?? null } : {}),
      // Planning is not an edit of the article: keep "last updated" as it was.
      updatedAt: post.updatedAt,
    })
    .where(eq(schema.posts.id, post.id));

  const title = await postTitle(post.id);
  if (plannedChanged) {
    await logActivity({
      userId: user.id,
      action: input.plannedFor ? "post.planned" : "post.unplanned",
      entityType: "post",
      entityId: post.id,
      siteId: post.siteId,
      meta: { title, ...(input.plannedFor ? { date: input.plannedFor } : {}) },
    });
  }
  if (assigneeChanged) {
    await logActivity({
      userId: user.id,
      action: assignee ? "post.assigned" : "post.unassigned",
      entityType: "post",
      entityId: post.id,
      siteId: post.siteId,
      meta: { title, ...(assignee ? { name: assignee.name } : {}) },
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/calendar");
  revalidatePath(`/admin/posts/${post.id}`);
  return { ok: true };
}

async function postTitle(postId: string) {
  const db = await getDb();
  const rows = await db
    .select({ title: schema.postTranslations.title, locale: schema.postTranslations.locale })
    .from(schema.postTranslations)
    .where(eq(schema.postTranslations.postId, postId));
  return rows.find((r) => r.locale === "vi")?.title || rows[0]?.title || "";
}
