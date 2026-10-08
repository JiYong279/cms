"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FolderTree, Info, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { AiEnginePanel, useAiEngine } from "@/components/ai-engine-panel";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { BriefSite } from "@/lib/ai-brief";
import { categoryPlanPrompt, parseCategoryPlan, reviewCategoryPlan, type ExistingCategory, type ReviewedIdea } from "@/lib/category-ai";
import { cn } from "@/lib/utils";
import { aiProposeCategories, applyCategoryPlan } from "./ai-actions";

type Props = {
  site: BriefSite;
  existing: ExistingCategory[];
  /** The website's articles and their current category, for the AI to read. */
  titles: { title: string; category: string | null }[];
  aiEnabled: boolean;
  /** "inline": a small button inside a list. */
  variant?: "primary" | "inline";
};

type Row = ReviewedIdea & { apply: boolean };

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20";
const KIND_STYLE: Record<ReviewedIdea["kind"], string> = {
  new: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rename: "bg-sky-50 text-sky-700 ring-sky-200",
  keep: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  merge: "bg-amber-50 text-amber-700 ring-amber-200",
};

/** "Propose categories with AI": the button and the dialog it opens. */
export function SuggestCategoriesButton({ variant = "primary", ...props }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-suggest-categories
        onClick={() => setOpen(true)}
        className={
          variant === "inline"
            ? "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-light px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
            : "inline-flex items-center gap-1.5 rounded-lg border border-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand-soft"
        }
      >
        <Sparkles className={variant === "inline" ? "size-3.5" : "size-4"} />
        {t.categories.ai.suggest}
      </button>
      {open && <SuggestDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function SuggestDialog({ site, existing, titles, aiEnabled, onClose }: Props & { onClose: () => void }) {
  const { t, lang } = useI18n();
  const c = t.categories;
  const s = c.ai;
  const router = useRouter();
  const titleId = useId();
  const [engine, setEngine] = useAiEngine(aiEnabled, null);
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unused, setUnused] = useState<ExistingCategory[]>([]);
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

  function review(ideas: Parameters<typeof reviewCategoryPlan>[0]) {
    const reviewed = reviewCategoryPlan(ideas, existing);
    // Only new categories start ticked: a rename moves every article of the category to the new name.
    setRows(reviewed.ideas.map((i) => ({ ...i, apply: i.kind === "new" })));
    setUnused(reviewed.unused);
    setError(null);
  }

  function onPaste(value: string) {
    setPasted(value);
    setError(null);
    if (!value.trim()) return;
    const read = parseCategoryPlan(value);
    if (read.ok) review(read.ideas);
    else setError(s.pasteErrors[read.error]);
  }

  function runBuiltin() {
    setError(null);
    setSeconds(0);
    startWork(async () => {
      const result = await aiProposeCategories({ siteId: site.id });
      if (result.ok) review(result.ideas);
      else setError(result.error);
    });
  }

  const chosen = rows?.filter((r) => r.apply && (r.kind === "new" || r.kind === "rename")) ?? [];
  const update = (row: Row, change: Partial<Row>) => setRows((list) => list?.map((r) => (r === row ? { ...r, ...change } : r)) ?? null);

  function apply() {
    setError(null);
    startWork(async () => {
      const pick = (r: Row) => ({ nameVi: r.nameVi, nameEn: r.nameEn, descriptionVi: r.descriptionVi, descriptionEn: r.descriptionEn });
      const result = await applyCategoryPlan({
        siteId: site.id,
        create: chosen.filter((r) => r.kind === "new").map(pick),
        rename: chosen.filter((r) => r.kind === "rename").map((r) => ({ id: r.existing[0].id, ...pick(r) })),
      });
      if (!result.ok) return setError(result.error);
      setDone(fmt(s.applied, { created: result.created, renamed: result.renamed }));
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[6vh]" onMouseDown={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-suggest-dialog
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Sparkles className="size-4 text-brand" />
              {s.suggest}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{s.suggestSubtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label={t.common.close} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>

        {done ? (
          <p role="status" className="mt-5 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            {done}
          </p>
        ) : rows === null ? (
          <fieldset disabled={running} className="mt-5 flex min-w-0 flex-col gap-3">
            <AiEnginePanel
              engine={engine}
              onEngine={(e) => (setEngine(e), setError(null))}
              aiEnabled={aiEnabled}
              buildPrompt={() => categoryPlanPrompt({ site, lang, existing, titles, answer: "paste" })}
              promptKey={lang}
              pasted={pasted}
              onPaste={onPaste}
              pastePlaceholder={s.suggestPaste}
            />
          </fieldset>
        ) : (
          <div className="mt-5" data-suggest-review>
            <p className="text-sm font-semibold text-ink">{fmt(s.review, { n: rows.length })}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{s.reviewHint}</p>
            <ol className="mt-3 flex flex-col gap-2.5">
              {rows.map((row, n) => {
                const editable = row.kind === "new" || row.kind === "rename";
                return (
                  <li key={n} data-idea-kind={row.kind} className={cn("rounded-xl border p-3.5", editable && row.apply ? "border-brand-light bg-brand-soft/30" : "border-zinc-200")}>
                    <div className="flex items-start gap-3">
                      {editable ? (
                        <input type="checkbox" checked={row.apply} aria-label={row.nameVi} onChange={() => update(row, { apply: !row.apply })} className="mt-1 size-4 accent-brand" />
                      ) : (
                        <FolderTree className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={cn("rounded-full px-2 py-0.5 font-semibold ring-1", KIND_STYLE[row.kind])}>{s.kinds[row.kind]}</span>
                          {row.kind === "rename" && <span className="text-zinc-500">{fmt(s.renameFrom, { name: row.existing[0].nameVi })}</span>}
                          {row.kind === "merge" && <span className="text-amber-700">{fmt(s.mergeFrom, { names: row.existing.map((e) => e.nameVi).join(", ") })}</span>}
                        </div>
                        {editable ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <input value={row.nameVi} aria-label={c.nameVi} onChange={(e) => update(row, { nameVi: e.target.value })} className={cn(inputClass, "font-semibold")} />
                            <input value={row.nameEn} aria-label={c.nameEn} onChange={(e) => update(row, { nameEn: e.target.value })} className={inputClass} />
                          </div>
                        ) : (
                          <p className="mt-1.5 text-sm font-semibold text-ink">
                            {row.nameVi} <span className="font-normal text-zinc-500">/ {row.nameEn}</span>
                          </p>
                        )}
                        {row.kind === "new" && row.descriptionVi && <p className="mt-2 text-xs leading-relaxed text-zinc-600">{lang === "en" && row.descriptionEn ? row.descriptionEn : row.descriptionVi}</p>}
                        {row.why && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{row.why}</p>}
                        {row.kind === "merge" && <p className="mt-1 text-xs text-amber-700">{s.mergeHint}</p>}
                        {row.kind === "rename" && row.existing[0].posts > 0 && (
                          <p className="mt-1 text-xs text-amber-700" data-rename-warning>
                            {fmt(s.renameWarning, { n: row.existing[0].posts })}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {unused.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" data-unused>
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  <span className="font-semibold">{s.unused}:</span> {unused.map((u) => u.nameVi).join(", ")}. {s.unusedHint}
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        {running && rows === null && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="size-4 animate-spin text-brand" />
            {fmt(s.working, { seconds })}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {rows !== null && !done && (
            <button type="button" onClick={() => (setRows(null), setPasted(""))} disabled={running} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
              <RotateCcw className="size-3.5" />
              {s.back}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={running} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">
            {done ? t.common.close : t.common.cancel}
          </button>
          {!done && rows !== null && (
            <button
              type="button"
              data-apply
              disabled={running || chosen.length === 0 || chosen.some((r) => !r.nameVi.trim() || !r.nameEn.trim())}
              onClick={apply}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50"
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <FolderTree className="size-4" />}
              {fmt(s.apply, { n: chosen.length })}
            </button>
          )}
          {!done && rows === null && engine === "builtin" && (
            <button type="button" disabled={running || !aiEnabled} onClick={runBuiltin} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {s.suggestRun}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
