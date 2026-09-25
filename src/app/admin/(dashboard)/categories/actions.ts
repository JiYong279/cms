"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Category, Locale } from "@/db/schema";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { categorySlug } from "@/lib/categories";
import { can } from "@/lib/permissions";
import { slugify } from "@/lib/posts";
import { notifySite } from "@/lib/revalidate";
import type { FormState } from "../users/actions";

const LOCALES = schema.localeEnum.enumValues as readonly Locale[];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function requireManager() {
  const user = await requireUser();
  return can(user.role, "categories.manage") ? user : null;
}

const CategoryInput = z.object({
  id: z.uuid().optional(),
  siteId: z.string().min(1),
  nameVi: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  slugVi: z.string().trim().max(80),
  slugEn: z.string().trim().max(80),
  descriptionVi: z.string().trim().max(400),
  descriptionEn: z.string().trim().max(400),
});

function read(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  return CategoryInput.safeParse({
    id: field("id") || undefined,
    siteId: field("siteId"),
    nameVi: field("nameVi"),
    nameEn: field("nameEn"),
    slugVi: field("slugVi"),
    slugEn: field("slugEn"),
    descriptionVi: field("descriptionVi"),
    descriptionEn: field("descriptionEn"),
  });
}

/** Adds a category, or saves it when the form carries its id. */
export async function saveCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const e = t.categories.errors;
  const user = await requireManager();
  if (!user) return { error: t.categories.noAccess };
  const parsed = read(formData);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { error: field.startsWith("name") ? e.nameRequired : t.posts.errors.invalid };
  }
  const input = parsed.data;
  const names = { vi: input.nameVi, en: input.nameEn };
  // An address typed by hand is tidied up; an empty one follows the name.
  const slugs = {
    vi: input.slugVi ? slugify(input.slugVi) : slugify(names.vi),
    en: input.slugEn ? slugify(input.slugEn) : slugify(names.en),
  };
  if (!SLUG.test(slugs.vi) || !SLUG.test(slugs.en)) return { error: e.badSlug };

  const db = await getDb();
  const siblings = await db.select().from(schema.categories).where(eq(schema.categories.siteId, input.siteId));
  for (const other of siblings) {
    if (other.id === input.id) continue;
    for (const l of LOCALES) {
      if (categorySlug(other, l) === slugs[l]) return { error: fmt(e.slugTaken, { slug: slugs[l] }) };
    }
  }
  const values = { names, slugs, descriptions: { vi: input.descriptionVi, en: input.descriptionEn } };

  let saved: Category | undefined;
  if (input.id) {
    [saved] = await db
      .update(schema.categories)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(schema.categories.id, input.id), eq(schema.categories.siteId, input.siteId)))
      .returning();
    if (!saved) return { error: e.notFound };
  } else {
    const [{ last }] = await db
      .select({ last: max(schema.categories.position) })
      .from(schema.categories)
      .where(eq(schema.categories.siteId, input.siteId));
    [saved] = await db
      .insert(schema.categories)
      .values({ ...values, siteId: input.siteId, position: (last ?? -1) + 1 })
      .returning();
  }

  await logActivity({
    userId: user.id,
    action: input.id ? "category.updated" : "category.created",
    entityType: "site",
    entityId: input.siteId,
    siteId: input.siteId,
    meta: { name: names.vi, nameEn: names.en, categoryId: saved.id },
  });
  revalidatePath("/admin/categories");
  // Names and addresses show on the website's article cards and category pages.
  notifySite(input.siteId);
  return { success: input.id ? t.categories.saved : t.categories.created };
}

/** Deletes a category; its articles become uncategorised. */
export async function deleteCategory(id: string): Promise<FormState> {
  const t = await getT();
  const user = await requireManager();
  if (!user) return { error: t.categories.noAccess };
  if (!z.uuid().safeParse(id).success) return { error: t.categories.errors.notFound };
  const db = await getDb();
  const [deleted] = await db.delete(schema.categories).where(eq(schema.categories.id, id)).returning();
  if (!deleted) return { error: t.categories.errors.notFound };

  await logActivity({
    userId: user.id,
    action: "category.deleted",
    entityType: "site",
    entityId: deleted.siteId,
    siteId: deleted.siteId,
    meta: { name: deleted.names.vi ?? deleted.names.en ?? "", nameEn: deleted.names.en ?? deleted.names.vi ?? "" },
  });
  revalidatePath("/admin/categories");
  notifySite(deleted.siteId);
  return { success: t.categories.saved };
}

/** Swaps a category with its neighbour above or below, which sets the order on the website. */
export async function moveCategory(id: string, direction: "up" | "down"): Promise<FormState> {
  const t = await getT();
  const user = await requireManager();
  if (!user) return { error: t.categories.noAccess };
  const db = await getDb();
  const [category] = await db.select().from(schema.categories).where(eq(schema.categories.id, id)).limit(1);
  if (!category) return { error: t.categories.errors.notFound };

  const ordered = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.siteId, category.siteId))
    .orderBy(asc(schema.categories.position), asc(schema.categories.createdAt));
  const from = ordered.findIndex((c) => c.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return {};
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  // Rewrite every position so older rows that all shared 0 get a real order too.
  await db.transaction(async (tx) => {
    for (const [position, c] of ordered.entries()) {
      await tx.update(schema.categories).set({ position }).where(eq(schema.categories.id, c.id));
    }
  });

  revalidatePath("/admin/categories");
  notifySite(category.siteId);
  return {};
}

