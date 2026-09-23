"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLanguage } from "@/i18n/actions";
import { useI18n } from "@/i18n/client";
import { LANGS } from "@/i18n/config";
import { cn } from "@/lib/utils";

/** VI | EN toggle for the interface language. */
export function LanguageSwitch({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div
      role="group"
      aria-label={t.common.language}
      className={cn("inline-flex rounded-lg p-0.5 text-xs font-bold", onDark ? "bg-white/10" : "bg-zinc-100", className)}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={l === lang}
          title={t.common.locales[l]}
          onClick={() =>
            start(async () => {
              await setLanguage(l);
              router.refresh();
            })
          }
          className={cn(
            "rounded-md px-2.5 py-1 uppercase transition",
            l === lang
              ? onDark
                ? "bg-white text-ink"
                : "bg-white text-ink shadow-sm"
              : onDark
                ? "text-white/60 hover:text-white"
                : "text-zinc-500 hover:text-zinc-800",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
