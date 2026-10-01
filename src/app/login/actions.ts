"use server";

import bcrypt from "bcryptjs";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { createSession, destroySession } from "@/lib/auth";
import { isWeakPassword } from "@/lib/passwords";
import { HOME_PATH } from "@/lib/paths";
import { logActivity } from "@/lib/activity";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";

export type LoginState = { error?: string; email?: string };

const LoginInput = z.object({
  email: z.email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
});

/** Failures allowed per window before sign-in is paused, per account and per network address. */
const WINDOW_MINUTES = 15;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 20;

async function clientIp() {
  const h = await headers();
  // Reverse proxies (such as the server's edge proxy) set x-real-ip to the address that actually connected.
  return h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = (await getT()).common.login;
  const email = String(formData.get("email") ?? "");
  const parsed = LoginInput.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: t.errorInvalid, email };

  const db = await getDb();
  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const recent = (where: ReturnType<typeof eq>) =>
    db
      .select({ n: count() })
      .from(schema.loginAttempts)
      .where(and(where, gt(schema.loginAttempts.createdAt, since)))
      .then(([row]) => row.n);

  if (
    (await recent(eq(schema.loginAttempts.email, parsed.data.email))) >= MAX_PER_EMAIL ||
    (await recent(eq(schema.loginAttempts.ip, ip))) >= MAX_PER_IP
  ) {
    return { error: fmt(t.errorLocked, { minutes: WINDOW_MINUTES }), email };
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  // Same message whether the email or the password is wrong, so accounts can't be probed.
  const valid = user?.active && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!user || !valid) {
    await db.insert(schema.loginAttempts).values({ email: parsed.data.email, ip });
    return { error: t.errorWrong, email };
  }

  await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.email, parsed.data.email));
  // Housekeeping: nothing reads expired sessions or old attempts again.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.createdAt, new Date(Date.now() - 86_400_000)));

  await createSession(user.id);
  await logActivity({ userId: user.id, action: "auth.login", entityType: "auth", entityId: user.id, meta: { ip } });
  redirect(isWeakPassword(parsed.data.password) ? "/admin/account?weak=1" : HOME_PATH);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
