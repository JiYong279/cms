"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { Role } from "@/db/schema";
import { ConfirmPopover } from "@/components/confirm-popover";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { ROLES, ROLE_BADGE, can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { setUserRole } from "./actions";

/**
 * The role column of the users list: pick another role to change it. Giving or taking away the
 * admin role asks first; the server checks everything again (own role, last admin).
 */
export function UserRoleSelect({ id, name, role }: { id: string; name: string; role: Role }) {
  const { t } = useI18n();
  const l = t.users.list;
  const router = useRouter();
  const [value, setValue] = useState(role);
  // The role waiting for the admin's confirmation.
  const [pending, setPending] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save(next: Role) {
    setError(null);
    setValue(next);
    start(async () => {
      const result = await setUserRole(id, next);
      if (result.error) {
        setValue(role);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const confirm =
    pending && can(pending, "users.manage")
      ? { message: fmt(l.confirmMakeAdmin, { name }), hint: l.confirmMakeAdminHint }
      : { message: fmt(l.confirmRemoveAdmin, { name }), hint: fmt(l.confirmRemoveAdminHint, { role: t.common.roles[pending ?? role] }) };

  return (
    <div className="flex flex-col items-start gap-1">
      <ConfirmPopover message={confirm.message} hint={confirm.hint} confirmLabel={l.confirmRoleChange} onConfirm={() => pending && save(pending)}>
        {(open) => (
          <span className="inline-flex items-center gap-1.5">
            <select
              value={value}
              disabled={busy}
              aria-label={fmt(l.roleOf, { name })}
              data-user-role={id}
              onChange={(e) => {
                const next = e.target.value as Role;
                // Managing users is everything (it includes deciding who may do what): ask first.
                if (can(next, "users.manage") !== can(value, "users.manage")) {
                  setPending(next);
                  open(e);
                } else save(next);
              }}
              className={cn(
                "cursor-pointer rounded-full border-0 py-0.5 pl-2 pr-6 text-xs font-medium outline-none focus:ring-2 focus:ring-brand-bright/30 disabled:cursor-wait",
                ROLE_BADGE[value],
              )}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t.common.roles[r]}
                </option>
              ))}
            </select>
            {busy && <Loader2 className="size-3.5 animate-spin text-zinc-400" />}
          </span>
        )}
      </ConfirmPopover>
      {error && (
        <p role="alert" className="max-w-56 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
