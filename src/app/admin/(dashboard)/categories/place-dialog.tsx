"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FolderInput, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { AiEnginePanel, useAiEngine } from "@/components/ai-engine-panel";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { BriefSite } from "@/lib/ai-brief";
import { MAX_PLACED_ARTICLES, parsePlacements, placementPrompt } from "@/lib/category-ai";
import { cn } from "@/lib/utils";
import { aiPlaceArticles, applyPlacements } from "./ai-actions";

type Props = {
  site: BriefSite;
  categories: { id: string; nameVi: string; nameEn: string }[];
  /** Articles without a category, the oldest first. */
  articles: { id: string; title: string; excerpt: string }[];
  aiEnabled: boolean;
  /** "inline": a small button inside a list, labelled without the count. */
  variant?: "primary" | "inline";
};

const selectClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20";

/** "Sort uncategorised articles": the button and the dialog it opens. */
export function PlaceArticlesButton({ variant = "primary", ...props }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (props.articles.length === 0) return null;
  return (
    <>
      <button
        type="button"
        data-place-articles
        onClick={() => setOpen(true)}
        className={
          variant === "inline"
            ? "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-light px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
            : "inline-flex items-center gap-1.5 rounded-lg border border-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand-soft"
        }
      >
        <FolderInput className={variant === "inline" ? "size-3.5" : "size-4"} />
        {variant === "inline" ? t.categories.ai.placeShort : fmt(t.categories.ai.place, { n: props.articles.length })}
      </button>
      {open && <PlaceDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlaceDialog({ site, categories, articles: all, aiEnabled, onClose }: Props & { onClose: () => void }) {
  const { t, lang } = useI18n();
  const s = t.categories.ai;
  const router = useRouter();
  const titleId = useId();
  // One request holds a limited number of articles; the rest wait for the next round.
  const articles = all.slice(0, MAX_PLACED_ARTICLES);
  const names = categories.map((c) => (lang === "en" ? c.nameEn || c.nameVi : c.nameVi || c.nameEn));
  const numbered = articles.map((a, i) => ({ n: i + 1, title: a.title || t.overview.todo.untitled, excerpt: a.excerpt }));
  const [engine, setEngine] = useAiEngine(aiEnabled, null);
  const [pasted, setPasted] = useState("");
  // Chosen category per article id ("" leaves it as is); null until the AI answered.
  const [choice, setChoice] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [running, startWork] = useTransition();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !running && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  function onPaste(value: string) {
    setPasted(value);
    setError(null);
    if (!value.trim()) return;
    const read = parsePlacements(value, numbered, names);
    if (!read.ok) return setError(s.pasteErrors[read.error]);
    setChoice(Object.fromEntries(articles.map((a, i) => [a.id, categories[names.indexOf(read.placements.get(i + 1) ?? "")]?.id ?? ""])));
  }

  function runBuiltin() {
    setError(null);
    setSeconds(0);
    startWork(async () => {
      const result = await aiPlaceArticles({ siteId: site.id, postIds: articles.map((a) => a.id) });
      if (!result.ok) return setError(result.error);
      const placed = new Map(result.placements.map((p) => [p.postId, p.categoryId]));
      setChoice(Object.fromEntries(articles.map((a) => [a.id, placed.get(a.id) ?? ""])));
    });
  }

  const chosen = choice ? articles.filter((a) => choice[a.id]) : [];

  function apply() {
    if (!choice) return;
    setError(null);
    startWork(async () => {
      const result = await applyPlacements({ siteId: site.id, placements: chosen.map((a) => ({ postId: a.id, categoryId: choice[a.id] })) });
      if (!result.ok) return setError(result.error);
      setDone(fmt(s.placed, { n: result.n }));
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[6vh]" onMouseDown={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-place-dialog
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-ink">
              <FolderInput className="size-4 text-brand" />
              {fmt(s.place, { n: all.length })}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{s.placeSubtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label={t.common.close} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>

        {categories.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-zinc-300 px-3 py-2.5 text-sm text-zinc-500">{s.noCategories}</p>
        ) : done ? (
          <p role="status" className="mt-5 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            {done}
          </p>
        ) : choice === null ? (
          <fieldset disabled={running} className="mt-5 flex min-w-0 flex-col gap-3">
            <AiEnginePanel
              engine={engine}
              onEngine={(e) => (setEngine(e), setError(null))}
              aiEnabled={aiEnabled}
              buildPrompt={() => placementPrompt({ site, lang, categories: names, articles: numbered, answer: "paste" })}
              promptKey={lang}
              pasted={pasted}
              onPaste={onPaste}
              pastePlaceholder={s.placePaste}
            />
          </fieldset>
        ) : (
          <div className="mt-5" data-place-review>
            <p className="text-sm font-semibold text-ink">{fmt(s.placeReview, { placed: chosen.length, n: articles.length })}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{s.placeReviewHint}</p>
            <ul className="mt-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              {articles.map((a) => (
                <li key={a.id} data-place-row={a.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5", !choice[a.id] && "opacity-60")}>
                  <span className="min-w-0 flex-1 basis-56 text-sm font-medium text-ink">{a.title || t.overview.todo.untitled}</span>
                  <select
                    value={choice[a.id]}
                    aria-label={a.title}
                    onChange={(e) => setChoice((c) => (c ? { ...c, [a.id]: e.target.value } : c))}
                    className={cn(selectClass, "basis-52 sm:w-52 sm:flex-none")}
                  >
                    <option value="">{s.leaveOut}</option>
                    {categories.map((c, i) => (
                      <option key={c.id} value={c.id}>
                        {names[i]}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        {running && choice === null && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="size-4 animate-spin text-brand" />
            {fmt(s.working, { seconds })}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {choice !== null && !done && (
            <button type="button" onClick={() => (setChoice(null), setPasted(""))} disabled={running} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
              <RotateCcw className="size-3.5" />
              {s.back}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={running} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">
            {done ? t.common.close : t.common.cancel}
          </button>
          {!done && choice !== null && (
            <button type="button" data-apply disabled={running || chosen.length === 0} onClick={apply} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50">
              {running ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4" />}
              {fmt(s.placeApply, { n: chosen.length })}
            </button>
          )}
          {!done && choice === null && categories.length > 0 && engine === "builtin" && (
            <button type="button" disabled={running || !aiEnabled} onClick={runBuiltin} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {s.placeRun}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
