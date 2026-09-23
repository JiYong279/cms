"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Globe, Loader2, Plus, X } from "lucide-react";
import { fmt, plural } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { createPost } from "../posts/actions";

export type SiteChoice = { id: string; name: string; baseUrl: string; posts: number };

/** "Viết bài mới" asks which website the article is for before creating it. */
export function NewPostButton({ sites, defaultSiteId }: { sites: SiteChoice[]; defaultSiteId?: string }) {
  const { t: dict } = useI18n();
  const t = dict.posts.newPost;
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        disabled={sites.length === 0}
        onClick={() => {
          setSiteId(defaultSiteId ?? sites[0]?.id ?? "");
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-hover disabled:opacity-60"
      >
        <Plus className="size-4" />
        {t.button}
      </button>

      {/* Always rendered (hidden while closed) so the form also works without JavaScript. */}
      <div
        className={cn("fixed inset-0 z-50 items-start justify-center bg-ink/30 px-4 pt-[15vh]", open ? "flex" : "hidden")}
        onMouseDown={() => setOpen(false)}
      >
        <form
          action={createPost}
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-post-title"
          className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="new-post-title" className="text-lg font-semibold text-ink">
                {t.title}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">{t.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={dict.common.close}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="size-4" />
            </button>
          </div>

          <fieldset className="mt-5 flex flex-col gap-2">
            <legend className="sr-only">{t.sitesLabel}</legend>
            {sites.map((site) => (
              <label
                key={site.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition",
                  siteId === site.id ? "border-brand bg-brand-soft ring-2 ring-brand/15" : "border-zinc-200 hover:border-zinc-300",
                )}
              >
                <input
                  type="radio"
                  name="siteId"
                  value={site.id}
                  checked={siteId === site.id}
                  onChange={() => setSiteId(site.id)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    siteId === site.id ? "bg-brand text-white" : "bg-zinc-100 text-zinc-500",
                  )}
                >
                  <Globe className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{site.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{site.baseUrl.replace(/^https?:\/\//, "")}</span>
                </span>
                <span className="shrink-0 text-xs text-zinc-500">{plural(site.posts, t.postsCountOne, t.postsCountOther)}</span>
              </label>
            ))}
          </fieldset>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
            >
              {dict.common.cancel}
            </button>
            <ConfirmButton siteName={sites.find((s) => s.id === siteId)?.name} template={t.confirm} />
          </div>
        </form>
      </div>
    </>
  );
}

function ConfirmButton({ siteName, template }: { siteName?: string; template: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !siteName}
      className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {fmt(template, { site: siteName ?? "" })}
    </button>
  );
}
