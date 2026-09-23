"use server";

import bcrypt from "bcryptjs";
import { and, count, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { dictionaries, fmt, type Dict } from "@/i18n";
import { getT } from "@/i18n/server";
import { requireUser, revokeSessions } from "@/lib/auth";
import { isWeakPassword, MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { describeActivity, type ActivityChange } from "@/lib/activity-text";

export type FormState = { error?: string; success?: string };

/** Validation schemas, with messages in the visitor's language. */
function schemas(t: Dict) {
  const e = t.users.errors;
  const password = z
    .string()
    .min(MIN_PASSWORD_LENGTH, fmt(e.passwordMin, { min: MIN_PASSWORD_LENGTH }))
    .max(200)
    .refine((v) => !isWeakPassword(v), e.passwordWeak);
  const role = z.enum(schema.roleEnum.enumValues, e.roleInvalid);
  const name = z.string().trim().min(1, e.nameRequired).max(100);

  return {
    CreateUser: z.object({
      name,
      email: z.email(e.emailInvalid).transform((v) => v.trim().toLowerCase()),
      role,
      password,
    }),
    UpdateUser: z.object({ id: z.uuid(), name, role, active: z.boolean() }),
    ResetPassword: z.object({ id: z.uuid(), password }),
  };
}

/** The Vietnamese log line stored as the fallback summary. */
function viSummary(action: string, meta: Record<string, unknown>) {
  return describeActivity({ action, summary: "", meta }, dictionaries.vi);
}

async function requireManager() {
  const user = await requireUser();
  return can(user.role, "users.manage") ? user : null;
}

function firstIssue(error: z.ZodError, t: Dict) {
  return error.issues[0]?.message ?? t.users.errors.invalid;
}

/** Postgres unique_violation, raised directly or wrapped by the driver. */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const manager = await requireManager();
  if (!manager) return { error: t.users.noAccess.create };

  const parsed = schemas(t).CreateUser.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error, t) };
  const input = parsed.data;

  const db = await getDb();
  try {
    const [created] = await db
      .insert(schema.users)
      .values({
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: await bcrypt.hash(input.password, 10),
      })
      .returning({ id: schema.users.id });
    const meta = { name: input.name, role: input.role, email: input.email };
    await logActivity({
      userId: manager.id,
      action: "user.created",
      entityType: "user",
      entityId: created.id,
      summary: viSummary("user.created", meta),
      meta,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: fmt(t.users.errors.emailTaken, { email: input.email }) };
    throw error;
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function updateUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const manager = await requireManager();
  if (!manager) return { error: t.users.noAccess.edit };

  const parsed = schemas(t).UpdateUser.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    role: formData.get("role"),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error, t) };
  const input = parsed.data;

  if (input.id === manager.id && (input.role !== manager.role || !input.active)) {
    return { error: t.users.errors.selfChange };
  }

  const db = await getDb();
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, input.id)).limit(1);
  if (!target) return { error: t.users.errors.notFound };

  // Never leave the CMS without an active admin.
  const losesAdmin = target.role === "admin" && target.active && (input.role !== "admin" || !input.active);
  if (losesAdmin) {
    const [{ value: otherAdmins }] = await db
      .select({ value: count() })
      .from(schema.users)
      .where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true), ne(schema.users.id, target.id)));
    if (otherAdmins === 0) return { error: t.users.errors.lastAdmin };
  }

  await db
    .update(schema.users)
    .set({ name: input.name, role: input.role, active: input.active })
    .where(eq(schema.users.id, input.id));
  if (!input.active) await revokeSessions(input.id);

  const changes: ActivityChange[] = [];
  if (target.role !== input.role) changes.push({ type: "role", from: target.role, to: input.role });
  if (target.active && !input.active) changes.push({ type: "lock" });
  if (!target.active && input.active) changes.push({ type: "unlock" });
  if (target.name !== input.name) changes.push({ type: "rename", to: input.name });
  if (changes.length) {
    const meta = { name: target.name, changes };
    await logActivity({
      userId: manager.id,
      action: "user.updated",
      entityType: "user",
      entityId: input.id,
      summary: viSummary("user.updated", meta),
      meta,
    });
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.id}`);
  return { success: input.active ? t.users.success.saved : t.users.success.locked };
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const manager = await requireManager();
  if (!manager) return { error: t.users.noAccess.reset };

  const parsed = schemas(t).ResetPassword.safeParse({ id: formData.get("id"), password: formData.get("password") });
  if (!parsed.success) return { error: firstIssue(parsed.error, t) };

  const db = await getDb();
  const [updated] = await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.password, 10) })
    .where(eq(schema.users.id, parsed.data.id))
    .returning({ id: schema.users.id, name: schema.users.name });
  if (!updated) return { error: t.users.errors.notFound };

  await revokeSessions(parsed.data.id, { keepCurrent: parsed.data.id === manager.id });
  const meta = { name: updated.name };
  await logActivity({
    userId: manager.id,
    action: "user.password_reset",
    entityType: "user",
    entityId: parsed.data.id,
    summary: viSummary("user.password_reset", meta),
    meta,
  });
  return { success: t.users.success.passwordReset };
}
