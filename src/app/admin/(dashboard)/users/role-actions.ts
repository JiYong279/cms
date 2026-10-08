"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import {
  EDITABLE_PERMISSIONS,
  EDITABLE_ROLES,
  can,
  isGrantedByDefault,
  setPermissionOverrides,
  type PermissionOverrides,
} from "@/lib/permissions";

export type SaveRolePermissionsResult = { ok: true } | { ok: false; error: string };

const PermissionList = z.array(z.enum(EDITABLE_PERMISSIONS));

/** For each role an admin may configure, every permission it should hold from now on. */
const RolePermissionsInput = z.object({ editor: PermissionList, writer: PermissionList });
type RolePermissionsInput = z.infer<typeof RolePermissionsInput>;

/**
 * Saves what editors and writers may do. Only the differences from the defaults are stored, so a
 * permission added to the code later starts with its default, and saving the defaults clears all.
 */
export async function saveRolePermissions(input: RolePermissionsInput): Promise<SaveRolePermissionsResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = RolePermissionsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t.users.roles.invalid };
  if (!can(user.role, "users.manage")) return { ok: false, error: t.users.noAccess.roles };

  const rows: (typeof schema.rolePermissions.$inferInsert)[] = [];
  const next: PermissionOverrides = {};
  const changes: { role: string; added: string[]; removed: string[] }[] = [];
  for (const role of EDITABLE_ROLES) {
    const wanted = new Set(parsed.data[role]);
    const added: string[] = [];
    const removed: string[] = [];
    for (const permission of EDITABLE_PERMISSIONS) {
      const granted = wanted.has(permission);
      // can() still answers with what was saved before this request.
      if (granted !== can(role, permission)) (granted ? added : removed).push(permission);
      if (granted === isGrantedByDefault(role, permission)) continue;
      rows.push({ role, permission, granted, updatedBy: user.id });
      (next[role] ??= {})[permission] = granted;
    }
    if (added.length || removed.length) changes.push({ role, added, removed });
  }
  if (changes.length === 0) return { ok: true };

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.rolePermissions);
    if (rows.length) await tx.insert(schema.rolePermissions).values(rows);
  });
  setPermissionOverrides(next);

  for (const change of changes) {
    await logActivity({ userId: user.id, action: "role.updated", entityType: "user", meta: change });
  }
  // Menus and pages of every signed-in person depend on these permissions.
  revalidatePath("/admin", "layout");
  return { ok: true };
}
