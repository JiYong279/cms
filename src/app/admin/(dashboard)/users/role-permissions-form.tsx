"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, CircleAlert, Loader2, Minus } from "lucide-react";
import type { Role } from "@/db/schema";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import {
  ALL_PERMISSIONS,
  EDITABLE_ROLES,
  ROLES,
  isAdminOnly,
  isEditableRole,
  isGrantedByDefault,
  type EditableRole,
  type Permission,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { saveRolePermissions } from "./role-actions";

type Grants = Record<EditableRole, Permission[]>;

type Props = {
  /** What editors and writers may do now (defaults plus the admin's saved changes). */
  grants: Grants;
};

const DEFAULTS = Object.fromEntries(
  EDITABLE_ROLES.map((role) => [role, ALL_PERMISSIONS.filter((p) => !isAdminOnly(p) && isGrantedByDefault(role, p))]),
) as Grants;

const sameGrants = (a: Grants, b: Grants) =>
  EDITABLE_ROLES.every((role) => a[role].length === b[role].length && a[role].every((p) => b[role].includes(p)));

/** The permissions table on the users page: admins tick what editors and writers may do. */
export function RolePermissionsForm({ grants }: Props) {
  const { t } = useI18n();
  const r = t.users.roles;
  const router = useRouter();
  const [saved, setSaved] = useState(grants);
  const [draft, setDraft] = useState(grants);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const dirty = !sameGrants(draft, saved);

  function toggle(role: EditableRole, permission: Permission) {
    setMessage(null);
    setDraft((d) => ({
      ...d,
      [role]: d[role].includes(permission) ? d[role].filter((p) => p !== permission) : [...d[role], permission],
    }));
  }

  function save() {
    setMessage(null);
    startSaving(async () => {
      const result = await saveRolePermissions(draft);
      if (!result.ok) return setMessage({ ok: false, text: result.error });
      setSaved(draft);
      setMessage({ ok: true, text: r.saved });
      router.refresh();
    });
  }

  const cell = (role: Role, permission: Permission) => {
    if (!isEditableRole(role)) return <Check className="mx-auto size-4 text-emerald-600" aria-label={t.users.list.yes} />;
    if (isAdminOnly(permission)) {
      return <Minus className="mx-auto size-4 text-zinc-300" aria-label={r.adminOnly} />;
    }
    const checked = draft[role].includes(permission);
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggle(role, permission)}
        disabled={saving}
        aria-label={fmt(r.toggle, { permission: t.common.permissions[permission], role: t.common.roles[role] })}
        data-role={role}
        data-permission={permission}
        className="mx-auto block size-4 cursor-pointer accent-brand disabled:cursor-wait"
      />
    );
  };

  return (
    <div className="mt-4">
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t.users.list.colPermission}</th>
              {ROLES.map((role) => (
                <th key={role} className="px-4 py-3 text-center font-medium">
                  {t.common.roles[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {ALL_PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <td className="px-4 py-2.5">
                  {t.common.permissions[permission]}
                  {isAdminOnly(permission) && <span className="ml-2 text-xs text-zinc-400">({r.adminOnly})</span>}
                </td>
                {ROLES.map((role) => {
                  const changed =
                    isEditableRole(role) && !isAdminOnly(permission) && draft[role].includes(permission) !== isGrantedByDefault(role, permission);
                  return (
                    <td key={role} className={cn("px-4 py-2.5", changed && "bg-amber-100")} title={changed ? r.changed : undefined}>
                      {cell(role, permission)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-zinc-500">{r.legend}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {r.save}
        </button>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setDraft(DEFAULTS);
          }}
          disabled={sameGrants(draft, DEFAULTS) || saving}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          {r.restoreDefaults}
        </button>
        {dirty && !saving && <span className="text-xs text-amber-700">{r.unsaved}</span>}
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn(
            "mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm",
            message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
          )}
        >
          {message.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
          {message.text}
        </p>
      )}
    </div>
  );
}
