import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Role } from "@/db/schema";
import { loadPermissionOverrides } from "./role-permissions";
import { SESSION_COOKIE } from "./session-cookie";

const SESSION_DAYS = 30;

export type CurrentUser = { id: string; name: string; email: string; role: Role };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Starts a session for the user and stores its token in an httpOnly cookie. Server Functions only. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const db = await getDb();
  await db.insert(schema.sessions).values({ id: hashToken(token), userId, expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Ends the current session. Server Functions only. */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/**
 * The signed-in user, or null. Cached for the duration of one request. Also loads what each role
 * may do, so every permission check in the request (can()) sees the admin's latest changes.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const [row] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.id, hashToken(token)),
        gt(schema.sessions.expiresAt, new Date()),
        eq(schema.users.active, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  await loadPermissionOverrides();
  return row;
});

/** Returns the signed-in user or sends the visitor to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Signs a user out everywhere, optionally keeping the session making this request. */
export async function revokeSessions(userId: string, { keepCurrent = false } = {}) {
  const db = await getDb();
  const token = keepCurrent ? (await cookies()).get(SESSION_COOKIE)?.value : undefined;
  await db
    .delete(schema.sessions)
    .where(
      token
        ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, hashToken(token)))
        : eq(schema.sessions.userId, userId),
    );
}
