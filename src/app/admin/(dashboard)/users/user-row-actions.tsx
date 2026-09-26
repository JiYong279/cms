"use client";

import { useState, useTransition } from "react";
import { Loader2, UserCheck, UserX } from "lucide-react";
import { ConfirmPopover } from "@/components/confirm-popover";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { setUserActive } from "./actions";

/** Disable an account (after confirming) or enable it again, from the users list. */
export function UserRowActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const { t } = useI18n();
  const l = t.users.list;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(next: boolean) {
    setError(null);
    start(async () => {
      const result = await setUserActive(id, next);
      if (result.error) setError(result.error);
    });
  }

  const button =
    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50";
  return (
    <div className="flex flex-col items-end gap-1">
      {active ? (
        <ConfirmPopover message={fmt(l.confirmDisable, { name })} hint={l.confirmDisableHint} confirmLabel={l.disable} onConfirm={() => run(false)}>
          {(open) => (
            <button type="button" onClick={open} disabled={pending} className={`${button} border-zinc-200 text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600`}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <UserX className="size-3.5" />}
              {l.disable}
            </button>
          )}
        </ConfirmPopover>
      ) : (
        <button type="button" onClick={() => run(true)} disabled={pending} className={`${button} border-brand-light text-brand hover:bg-brand-soft`}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <UserCheck className="size-3.5" />}
          {l.enable}
        </button>
      )}
      {error && (
        <p role="alert" className="max-w-56 text-right text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
