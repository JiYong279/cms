"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { dictionaries, fmt, type Dict } from "@/i18n";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { pingSite } from "@/lib/revalidate";
import { logActivity } from "@/lib/activity";
import { describeActivity } from "@/lib/activity-text";
import type { FormState } from "../users/actions";

/** Validation schema, with messages in the visitor's language. */
function siteSchema(t: Dict) {
  const e = t.users.settings.errors;
  const path = z
    .string()
    .trim()
    .regex(/^\/[a-z0-9/_-]*$/i, e.pathInvalid)
    .transform((v) => (v.length > 1 ? v.replace(/\/+$/, "") : v));

  const origin = z.url(e.domainInvalid).transform((v) => v.replace(/\/+$/, ""));

  return z.object({
    id: z.string().trim().regex(/^[a-z0-9-]{2,30}$/, e.idInvalid),
    name: z.string().trim().min(1, e.nameRequired).max(60),
    baseUrl: origin,
    blogPathVi: path,
    blogPathEn: path,
    defaultLocale: z.enum(schema.localeEnum.enumValues),
    revalidateUrl: z.union([z.literal(""), z.url(e.revalidateInvalid)]),
  });
}

/** The Vietnamese log line stored as the fallback summary. */
function viSummary(action: string, meta: Record<string, unknown>) {
  return describeActivity({ action, summary: "", meta }, dictionaries.vi);
}

async function requireSiteManager() {
  const user = await requireUser();
  return can(user.role, "sites.manage") ? user : null;
}

function parse(formData: FormData, t: Dict) {
  return siteSchema(t).safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    baseUrl: formData.get("baseUrl"),
    blogPathVi: formData.get("blogPathVi"),
    blogPathEn: formData.get("blogPathEn"),
    defaultLocale: formData.get("defaultLocale"),
    revalidateUrl: String(formData.get("revalidateUrl") ?? "").trim(),
  });
}

function values(input: z.output<ReturnType<typeof siteSchema>>) {
  return {
    name: input.name,
    baseUrl: input.baseUrl,
    blogPaths: { vi: input.blogPathVi, en: input.blogPathEn },
    defaultLocale: input.defaultLocale,
    revalidateUrl: input.revalidateUrl || null,
  };
}

export async function updateSite(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const manager = await requireSiteManager();
  if (!manager) return { error: t.users.settings.noAccess.edit };
  const parsed = parse(formData, t);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const db = await getDb();
  const updated = await db
    .update(schema.sites)
    .set(values(parsed.data))
    .where(eq(schema.sites.id, parsed.data.id))
    .returning({ id: schema.sites.id });
  if (updated.length === 0) return { error: t.users.settings.errors.notFound };
  // values() already carries the name the log line needs.
  const meta = values(parsed.data);
  await logActivity({
    userId: manager.id,
    action: "site.updated",
    entityType: "site",
    entityId: parsed.data.id,
    siteId: parsed.data.id,
    summary: viSummary("site.updated", meta),
    meta,
  });

  revalidatePath("/admin", "layout");
  return { success: t.users.settings.success.saved };
}

export async function createSite(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const manager = await requireSiteManager();
  if (!manager) return { error: t.users.settings.noAccess.create };
  const parsed = parse(formData, t);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const db = await getDb();
  const inserted = await db
    .insert(schema.sites)
    .values({ id: parsed.data.id, ...values(parsed.data) })
    .onConflictDoNothing()
    .returning({ id: schema.sites.id });
  if (inserted.length === 0) return { error: fmt(t.users.settings.errors.idTaken, { id: parsed.data.id }) };
  const meta = { name: parsed.data.name };
  await logActivity({
    userId: manager.id,
    action: "site.created",
    entityType: "site",
    entityId: parsed.data.id,
    siteId: parsed.data.id,
    summary: viSummary("site.created", meta),
    meta,
  });

  revalidatePath("/admin", "layout");
  return { success: fmt(t.users.settings.success.added, { name: parsed.data.name }) };
}

/** Sends a real refresh signal so the admin can check the connection before relying on it. */
export async function testSiteConnection(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const e = t.users.settings.errors;
  if (!(await requireSiteManager())) return { error: t.users.settings.noAccess.test };
  const url = String(formData.get("revalidateUrl") ?? "").trim();
  const id = String(formData.get("id") ?? "");
  if (!url) return { error: e.noUrl };
  if (!process.env.CMS_REVALIDATE_SECRET) return { error: e.noSecret };

  const result = await pingSite(url, id);
  if (result.ok) return { success: t.users.settings.success.connected };
  if (result.status === 401) return { error: e.rejected };
  if (result.status === 404) return { error: e.notFound404 };
  return { error: fmt(e.failed, { error: String(result.error) }) };
}
