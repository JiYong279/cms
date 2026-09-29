"use server";

import { and, eq, isNull, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Locale } from "@/db/schema";
import { fmt } from "@/i18n";
import { getLang, getT } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { AiError, placeArticles, proposeCategories } from "@/lib/ai";
import { AI_DAILY_LIMIT, getAiRunsToday } from "@/lib/ai-usage";
import { requireUser } from "@/lib/auth";
import { categoryName, categorySlug } from "@/lib/categories";
import { MAX_CATEGORY_IDEAS, MAX_PLACED_ARTICLES, type CategoryIdea } from "@/lib/category-ai";
import { can } from "@/lib/permissions";
import { LOCALES, slugify } from "@/lib/posts";
import { notifySite } from "@/lib/revalidate";

const SiteInput = z.object({ siteId: z.string().min(1).max(64) });

/** Where the category lists and counts show. */
function revalidateCategoryPages() {
  revalidatePath("/admin/categories");
  revalidatePath("/admin/overview");
  revalidatePath("/admin");
}

async function getSite(siteId: string) {
  const db = await getDb();
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1);
  return site;
}

function aiFailure(error: unknown, t: Awaited<ReturnType<typeof getT>>): { ok: false; error: string } {
  if (error instanceof AiError) return { ok: false, error: t.editor.ai.errors[error.code] };
  console.error("[ai] categories failed:", error);
  return { ok: false, error: t.editor.ai.errors.unavailable };
}

export type ProposeCategoriesResult = { ok: true; ideas: CategoryIdea[] } | { ok: false; error: string };

/** The built-in AI's categories for a website. Nothing changes until the team applies some. */
export async function aiProposeCategories(raw: z.input<typeof SiteInput>): Promise<ProposeCategoriesResult> {
  const user = await requireUser();
  const t = await getT();
  const lang = await getLang();
  const parsed = SiteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.posts.errors.invalid };
  if (!can(user.role, "categories.manage")) return { ok: false, error: t.categories.noAccess };
  const site = await getSite(parsed.data.siteId);
  if (!site) return { ok: false, error: t.posts.errors.invalid };
  if ((await getAiRunsToday(user.id)) >= AI_DAILY_LIMIT) return { ok: false, error: fmt(t.editor.ai.errors.dailyLimit, { n: AI_DAILY_LIMIT }) };

  const db = await getDb();
  const [categories, posts] = await Promise.all([
    db.select().from(schema.categories).where(eq(schema.categories.siteId, site.id)),
    db.query.posts.findMany({ where: (p, { and, eq, isNull }) => and(eq(p.siteId, site.id), isNull(p.deletedAt)), with: { translations: true } }),
  ]);
  try {
    const ideas = await proposeCategories({
      site: { id: site.id, name: site.name, baseUrl: site.baseUrl, brief: site.contentBrief },
      lang,
      existing: categories.map((c) => ({ id: c.id, nameVi: categoryName(c, "vi"), nameEn: categoryName(c, "en"), posts: posts.filter((p) => p.categoryId === c.id).length })),
      titles: posts.map((p) => {
        const category = categories.find((c) => c.id === p.categoryId);
        return {
          title: (p.translations.find((tr) => tr.locale === site.defaultLocale) ?? p.translations[0])?.title ?? "",
          category: category ? categoryName(category, "vi") : null,
        };
      }),
    });
    await logActivity({ userId: user.id, action: "category.ai_proposed", entityType: "site", entityId: site.id, siteId: site.id, meta: { n: ideas.length, name: site.name } });
    return { ok: true, ideas };
  } catch (error) {
    return aiFailure(error, t);
  }
}

const Names = {
  nameVi: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  descriptionVi: z.string().trim().max(400),
  descriptionEn: z.string().trim().max(400),
};

const ApplyPlanInput = z.object({
  siteId: z.string().min(1).max(64),
  create: z.array(z.object(Names)).max(MAX_CATEGORY_IDEAS),
  rename: z.array(z.object({ id: z.uuid(), ...Names })).max(MAX_CATEGORY_IDEAS),
});

export type ApplyPlanResult = { ok: true; created: number; renamed: number } | { ok: false; error: string };

/** Creates the new categories and renames the kept ones the team ticked. Nothing is deleted or merged. */
export async function applyCategoryPlan(raw: z.input<typeof ApplyPlanInput>): Promise<ApplyPlanResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = ApplyPlanInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.categories.errors.nameRequired };
  if (!can(user.role, "categories.manage")) return { ok: false, error: t.categories.noAccess };
  const input = parsed.data;
  const site = await getSite(input.siteId);
  if (!site) return { ok: false, error: t.posts.errors.invalid };

  const db = await getDb();
  const siblings = await db.select().from(schema.categories).where(eq(schema.categories.siteId, site.id));
  if (input.rename.some((r) => !siblings.some((c) => c.id === r.id))) return { ok: false, error: t.categories.errors.notFound };
  // A renamed category keeps its address, so links to its page keep working.
  const taken = new Set(siblings.flatMap((c) => LOCALES.map((l) => `${l}:${categorySlug(c, l)}`)));
  const created = input.create.map((c) => ({ ...c, slugs: { vi: slugify(c.nameVi), en: slugify(c.nameEn) } }));
  for (const c of created) {
    for (const l of LOCALES) {
      if (!c.slugs[l] || taken.has(`${l}:${c.slugs[l]}`)) return { ok: false, error: fmt(t.categories.errors.slugTaken, { slug: c.slugs[l] }) };
      taken.add(`${l}:${c.slugs[l]}`);
    }
  }

  await db.transaction(async (tx) => {
    const [{ last }] = await tx.select({ last: max(schema.categories.position) }).from(schema.categories).where(eq(schema.categories.siteId, site.id));
    for (const [i, c] of created.entries()) {
      await tx.insert(schema.categories).values({
        siteId: site.id,
        names: { vi: c.nameVi, en: c.nameEn },
        slugs: c.slugs,
        descriptions: { vi: c.descriptionVi, en: c.descriptionEn },
        position: (last ?? -1) + 1 + i,
      });
    }
    for (const r of input.rename) {
      const current = siblings.find((c) => c.id === r.id);
      if (!current) continue;
      await tx
        .update(schema.categories)
        .set({
          names: { vi: r.nameVi, en: r.nameEn },
          slugs: { vi: categorySlug(current, "vi"), en: categorySlug(current, "en") },
          descriptions: { vi: r.descriptionVi || (current.descriptions.vi ?? ""), en: r.descriptionEn || (current.descriptions.en ?? "") },
          updatedAt: new Date(),
        })
        .where(and(eq(schema.categories.id, r.id), eq(schema.categories.siteId, site.id)));
    }
  });

  for (const c of created) {
    await logActivity({ userId: user.id, action: "category.created", entityType: "site", entityId: site.id, siteId: site.id, meta: { name: c.nameVi, nameEn: c.nameEn } });
  }
  for (const r of input.rename) {
    await logActivity({ userId: user.id, action: "category.updated", entityType: "site", entityId: site.id, siteId: site.id, meta: { name: r.nameVi, nameEn: r.nameEn, categoryId: r.id } });
  }
  revalidateCategoryPages();
  // Names show on the website's article cards and category pages.
  notifySite(site.id);
  return { ok: true, created: created.length, renamed: input.rename.length };
}

const PlaceInput = z.object({
  siteId: z.string().min(1).max(64),
  postIds: z.array(z.uuid()).min(1).max(MAX_PLACED_ARTICLES),
});

export type PlaceResult = { ok: true; placements: { postId: string; categoryId: string }[] } | { ok: false; error: string };

/** The built-in AI's category for each of these articles. Nothing changes until the team applies them. */
export async function aiPlaceArticles(raw: z.input<typeof PlaceInput>): Promise<PlaceResult> {
  const user = await requireUser();
  const t = await getT();
  const lang = await getLang();
  const parsed = PlaceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.posts.errors.invalid };
  if (!can(user.role, "categories.manage")) return { ok: false, error: t.categories.noAccess };
  const site = await getSite(parsed.data.siteId);
  if (!site) return { ok: false, error: t.posts.errors.invalid };
  if ((await getAiRunsToday(user.id)) >= AI_DAILY_LIMIT) return { ok: false, error: fmt(t.editor.ai.errors.dailyLimit, { n: AI_DAILY_LIMIT }) };

  const db = await getDb();
  const [categories, posts] = await Promise.all([
    db.select().from(schema.categories).where(eq(schema.categories.siteId, site.id)),
    db.query.posts.findMany({
      where: (p, { and, eq, inArray, isNull }) => and(eq(p.siteId, site.id), isNull(p.deletedAt), inArray(p.id, parsed.data.postIds)),
      with: { translations: true },
    }),
  ]);
  if (categories.length === 0) return { ok: false, error: t.categories.ai.noCategories };
  const names = categories.map((c) => categoryName(c, lang));
  const articles = posts.map((p, i) => {
    const tr = p.translations.find((x) => x.locale === lang) ?? p.translations[0];
    return { n: i + 1, title: tr?.title ?? "", excerpt: tr?.excerpt ?? "" };
  });
  try {
    const placed = await placeArticles({ site: { id: site.id, name: site.name, baseUrl: site.baseUrl, brief: site.contentBrief }, lang, categories: names, articles });
    await logActivity({ userId: user.id, action: "post.ai_categorized", entityType: "site", entityId: site.id, siteId: site.id, meta: { n: placed.size, name: site.name } });
    return {
      ok: true,
      placements: [...placed].map(([n, name]) => ({ postId: posts[n - 1].id, categoryId: categories[names.indexOf(name)].id })),
    };
  } catch (error) {
    return aiFailure(error, t);
  }
}

const ApplyPlacementsInput = z.object({
  siteId: z.string().min(1).max(64),
  placements: z.array(z.object({ postId: z.uuid(), categoryId: z.uuid() })).min(1).max(200),
});

export type ApplyPlacementsResult = { ok: true; n: number } | { ok: false; error: string };

/** Puts each article in the category the team settled on. */
export async function applyPlacements(raw: z.input<typeof ApplyPlacementsInput>): Promise<ApplyPlacementsResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = ApplyPlacementsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.posts.errors.invalid };
  // Moving someone else's article needs the right to edit it, which category managers have.
  if (!can(user.role, "categories.manage") || !can(user.role, "posts.editAny")) return { ok: false, error: t.categories.noAccess };
  const input = parsed.data;

  const db = await getDb();
  const categories = await db.select().from(schema.categories).where(eq(schema.categories.siteId, input.siteId));
  const posts = await db.query.posts.findMany({
    where: (p, { and, eq, inArray, isNull }) => and(eq(p.siteId, input.siteId), isNull(p.deletedAt), inArray(p.id, input.placements.map((x) => x.postId))),
    with: { translations: true },
  });
  const valid = input.placements.every((x) => categories.some((c) => c.id === x.categoryId) && posts.some((p) => p.id === x.postId));
  if (!valid) return { ok: false, error: t.posts.errors.invalid };

  await db.transaction(async (tx) => {
    for (const x of input.placements) {
      await tx
        .update(schema.posts)
        .set({ categoryId: x.categoryId, updatedAt: new Date() })
        .where(and(eq(schema.posts.id, x.postId), eq(schema.posts.siteId, input.siteId), isNull(schema.posts.deletedAt)));
    }
  });

  for (const x of input.placements) {
    const category = categories.find((c) => c.id === x.categoryId);
    await logActivity({
      userId: user.id,
      action: "post.categorized",
      entityType: "post",
      entityId: x.postId,
      siteId: input.siteId,
      meta: { name: category ? categoryName(category, "vi") : "", nameEn: category ? categoryName(category, "en") : "" },
    });
  }
  revalidateCategoryPages();
  // Live articles show their category on the website.
  const live = posts.filter((p) => input.placements.some((x) => x.postId === p.id)).flatMap((p) => p.translations.filter((tr) => tr.status === "published"));
  if (live.length) {
    const slugs = Object.fromEntries(LOCALES.map((l) => [l, live.filter((tr) => tr.locale === l).map((tr) => tr.slug)])) as Record<Locale, string[]>;
    notifySite(input.siteId, slugs);
  }
  return { ok: true, n: input.placements.length };
}

