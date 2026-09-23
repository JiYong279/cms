"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { dictionaries, fmt, type Dict } from "@/i18n";
import { getT } from "@/i18n/server";
import { logActivity } from "@/lib/activity";
import { requireUser, revokeSessions } from "@/lib/auth";
import { isWeakPassword, MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import type { FormState } from "../users/actions";

/** Validation schemas, with messages in the visitor's language. */
function schemas(t: Dict) {
  const e = t.users.account.errors;
  return {
    Profile: z.object({ name: z.string().trim().min(1, t.users.errors.nameRequired).max(100) }),
    ChangePassword: z
      .object({
        current: z.string().min(1, e.currentRequired),
        next: z
          .string()
          .min(MIN_PASSWORD_LENGTH, fmt(e.newPasswordMin, { min: MIN_PASSWORD_LENGTH }))
          .max(200)
          .refine((v) => !isWeakPassword(v), t.users.errors.passwordWeak),
        confirm: z.string(),
      })
      .refine((v) => v.next === v.confirm, e.mismatch),
  };
}

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const parsed = schemas(t).Profile.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const db = await getDb();
  await db.update(schema.users).set({ name: parsed.data.name }).where(eq(schema.users.id, user.id));
  revalidatePath("/admin", "layout");
  return { success: t.users.account.success.nameUpdated };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const parsed = schemas(t).ChangePassword.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const db = await getDb();
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (!row || !(await bcrypt.compare(parsed.data.current, row.passwordHash))) {
    return { error: t.users.account.errors.currentWrong };
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.next, 10) })
    .where(eq(schema.users.id, user.id));
  await revokeSessions(user.id, { keepCurrent: true });
  await logActivity({
    userId: user.id,
    action: "user.password_changed",
    entityType: "user",
    entityId: user.id,
    summary: dictionaries.vi.activity.actions["user.password_changed"],
  });
  return { success: t.users.account.success.passwordChanged };
}
