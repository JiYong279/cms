import { getDb, schema } from "@/db";
import { isAdminOnly, isEditableRole, isPermission, setPermissionOverrides, type PermissionOverrides } from "./permissions";

/**
 * Reads the admin's changes to what each role may do (role_permissions) and makes can() use them.
 * Called once per request by getCurrentUser, so a change applies on every server at the next click.
 */
export async function loadPermissionOverrides(): Promise<PermissionOverrides> {
  const db = await getDb();
  const rows = await db
    .select({ role: schema.rolePermissions.role, permission: schema.rolePermissions.permission, granted: schema.rolePermissions.granted })
    .from(schema.rolePermissions);
  const next: PermissionOverrides = {};
  for (const row of rows) {
    // A permission the code no longer has, or one only admins may hold, is ignored.
    if (!isEditableRole(row.role) || !isPermission(row.permission) || isAdminOnly(row.permission)) continue;
    (next[row.role] ??= {})[row.permission] = row.granted;
  }
  setPermissionOverrides(next);
  return next;
}
