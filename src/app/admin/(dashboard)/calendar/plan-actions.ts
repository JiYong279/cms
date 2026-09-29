"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { AiError, proposeContentPlan } from "@/lib/ai";
import { AI_DAILY_LIMIT, getAiRunsToday } from "@/lib/ai-usage";
import { requireUser } from "@/lib/auth";
import { categoryName } from "@/lib/categories";
import { MAX_PLAN_ARTICLES, outlineBody, type PlanIdea } from "@/lib/content-plan";
import { can } from "@/lib/permissions";

const localeSchema = z.enum(schema.localeEnum.enumValues);

const ProposeInput = z.object({
  siteId: z.string().min(1).max(64),
  locale: localeSchema,
  topic: z.string().trim().min(3).max(500),
  count: z.number().int().min(1).max(MAX_PLAN_ARTICLES),
});

export type ProposeResult = { ok: true; ideas: PlanIdea[] } | { ok: false; error: string };

/** The built-in AI's plan for a cluster of articles. Nothing is created until the team keeps some. */
export async function aiProposePlan(raw: z.input<typeof ProposeInput>): Promise<ProposeResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = ProposeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.posts.errors.invalid };
  if (!can(user.role, "posts.create")) return { ok: false, error: t.posts.errors.notAllowedEdit };
  const input = parsed.data;

  const db = await getDb();
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, input.siteId)).limit(1);
  if (!site) return { ok: false, error: t.posts.errors.invalid };
  if ((await getAiRunsToday(user.id)) >= AI_DAILY_LIMIT) return { ok: false, error: fmt(t.editor.ai.errors.dailyLimit, { n: AI_DAILY_LIMIT }) };

  const [glossary, categories, existing] = await Promise.all([
    db
      .select({ vi: schema.glossary.vi, en: schema.glossary.en, note: schema.glossary.note })
      .from(schema.glossary)
      .where(eq(schema.glossary.siteId, site.id)),
    db.select().from(schema.categories).where(eq(schema.categories.siteId, site.id)),
    existingTitles(site.id, input.locale),
  ]);

  try {
    const ideas = await proposeContentPlan({
      siteId: site.id,
      site: { name: site.name, baseUrl: site.baseUrl, brief: site.contentBrief, glossary, categories: categories.map((c) => categoryName(c, input.locale)) },
      locale: input.locale,
      topic: input.topic,
      count: input.count,
      existing,
    });
    await logActivity({
      userId: user.id,
      action: "post.ai_planned",
      entityType: "post",
      siteId: site.id,
      meta: { topic: input.topic, n: ideas.length, name: site.name },
    });
    return { ok: true, ideas };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error: t.editor.ai.errors[error.code] };
    console.error("[ai] plan failed:", error);
    return { ok: false, error: t.editor.ai.errors.unavailable };
  }
}

/** Titles the website already has in `locale` (trash left out), so a plan does not repeat them. */
async function existingTitles(siteId: string, locale: z.infer<typeof localeSchema>) {
  const db = await getDb();
  const rows = await db
    .select({ title: schema.postTranslations.title })
    .from(schema.postTranslations)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTranslations.postId))
    .where(and(eq(schema.postTranslations.siteId, siteId), eq(schema.postTranslations.locale, locale), isNull(schema.posts.deletedAt)));
  return rows.map((r) => r.title).filter((title) => title.trim());
}

const CreateInput = z.object({
  siteId: z.string().min(1).max(64),
  locale: localeSchema,
  ideas: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        focusKeyword: z.string().trim().max(100),
        categoryId: z.uuid().nullable(),
        /** The overview article of the cluster. */
        pillar: z.boolean().optional(),
        plannedFor: z.iso.date(),
        why: z.string().trim().max(500),
        outline: z.array(z.string().trim().min(1).max(200)).max(12),
      }),
    )
    .min(1)
    .max(MAX_PLAN_ARTICLES),
});

export type CreatePlanResult = { ok: true; ids: string[] } | { ok: false; error: string };

/** Turns the kept ideas into drafts on their planned days, each starting with its outline. */
export async function createPlannedPosts(raw: z.input<typeof CreateInput>): Promise<CreatePlanResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = CreateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.posts.errors.invalid };
  if (!can(user.role, "posts.create")) return { ok: false, error: t.posts.errors.notAllowedEdit };
  const input = parsed.data;

  const db = await getDb();
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, input.siteId)).limit(1);
  if (!site) return { ok: false, error: t.posts.errors.invalid };
  const siteCategories = new Set(
    (await db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.siteId, site.id))).map((c) => c.id),
  );
  if (input.ideas.some((i) => i.categoryId && !siteCategories.has(i.categoryId))) return { ok: false, error: t.posts.errors.invalid };

  const created = await db.transaction(async (tx) => {
    const out: { id: string; title: string }[] = [];
    for (const idea of input.ideas) {
      const [post] = await tx
        .insert(schema.posts)
        .values({ siteId: site.id, authorId: user.id, categoryId: idea.categoryId, pillar: idea.pillar ?? false, plannedFor: idea.plannedFor })
        .returning();
      const body = outlineBody(idea, input.locale);
      await tx.insert(schema.postTranslations).values({
        postId: post.id,
        siteId: site.id,
        locale: input.locale,
        title: idea.title,
        // The placeholder the editor replaces with one made from the title on the first save.
        slug: `bai-viet-${post.id.slice(0, 8)}`,
        focusKeyword: idea.focusKeyword,
        contentJson: body.json,
        contentHtml: body.html,
        updatedBy: user.id,
      });
      out.push({ id: post.id, title: idea.title });
    }
    return out;
  });

  for (const post of created) {
    await logActivity({
      userId: user.id,
      action: "post.created",
      entityType: "post",
      entityId: post.id,
      siteId: site.id,
      meta: { title: post.title },
      summary: `Tạo bài mới cho ${site.name}`,
    });
  }
  revalidatePath("/admin");
  revalidatePath("/admin/calendar");
  return { ok: true, ids: created.map((p) => p.id) };
}
