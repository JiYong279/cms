"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, CircleAlert, Loader2, RotateCcw, Sparkles, Star, X } from "lucide-react";
import type { Locale } from "@/db/schema";
import { fmt } from "@/i18n";
import { AiEnginePanel, type AiEngine } from "@/components/ai-engine-panel";
import { useI18n } from "@/i18n/client";
import type { ContentBrief } from "@/lib/ai-brief";
import { CADENCES, MAX_PLAN_ARTICLES, contentPlanPrompt, parseContentPlan, planDates, type Cadence, type PlanIdea } from "@/lib/content-plan";
import { slugify } from "@/lib/posts";
import { cn } from "@/lib/utils";
import { aiProposePlan, createPlannedPosts } from "./plan-actions";

export type PlanSite = {
  id: string;
  name: string;
  baseUrl: string;
  brief: ContentBrief;
  defaultLocale: Locale;
  categories: { id: string; names: Partial<Record<Locale, string>> }[];
  /** Titles already written, per language: the plan must not repeat them. */
  titles: Record<Locale, string[]>;
};

type Props = {
  sites: PlanSite[];
  defaultSiteId?: string;
  /** First day offered for the plan (tomorrow, in the viewer's time zone). */
  startDay: string;
  aiEnabled: boolean;
  /** The topic the dialog opens with (the content overview plans one topic at a time). */
  initialTopic?: string;
};

type ButtonProps = Props & {
  /** "inline": a small link-like button inside a list, with its own label. */
  variant?: "primary" | "inline";
  label?: string;
};

type Idea = PlanIdea & { keep: boolean; categoryId: string | null };

const LOCALES: Locale[] = ["vi", "en"];
const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20";
const primaryButton =
  "inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50";

/** "Plan with AI": the calendar's button and the dialog it opens. */
export function PlanWithAiButton({ variant = "primary", label, ...props }: ButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-plan-ai
        onClick={() => setOpen(true)}
        className={
          variant === "inline"
            ? "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-light px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
            : "inline-flex items-center gap-2 rounded-lg border border-brand bg-white px-4 py-2.5 text-sm font-semibold text-brand shadow-sm hover:bg-brand-soft"
        }
      >
        <Sparkles className={variant === "inline" ? "size-3.5" : "size-4"} />
        {label ?? t.posts.plan.button}
      </button>
      {open && <PlanDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlanDialog({ sites, defaultSiteId, startDay, aiEnabled, initialTopic, onClose }: Props & { onClose: () => void }) {
  const { t } = useI18n();
  const p = t.posts.plan;
  const a = t.editor.ai;
  const router = useRouter();
  const titleId = useId();
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const [locale, setLocale] = useState<Locale>(site?.defaultLocale ?? "vi");
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [count, setCount] = useState(10);
  const [start, setStart] = useState(startDay);
  const [cadence, setCadence] = useState<Cadence>("weekdays");
  const [engine, setEngine] = useState<AiEngine>(aiEnabled ? "builtin" : "own");
  const [pasted, setPasted] = useState("");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!site) return null;
  const categoryNames = site.categories.map((c) => c.names[locale] || c.names.vi || c.names.en || "");
  const existing = site.titles[locale];
  const existingSlugs = new Set(existing.map(slugify));
  const topicOk = topic.trim().length >= 3;

  /** Shows the proposal, matching each idea's category to the website's. */
  function review(list: PlanIdea[]) {
    const byName = (name: string) => site.categories.find((c, i) => categoryNames[i].toLowerCase() === name.trim().toLowerCase())?.id ?? null;
    setIdeas(list.slice(0, MAX_PLAN_ARTICLES).map((i) => ({ ...i, keep: true, categoryId: byName(i.category) })));
    setError(null);
  }

  function buildPrompt() {
    if (!topicOk) {
      setError(a.errors.topic);
      return null;
    }
    return contentPlanPrompt({ site, locale, topic, count, categories: categoryNames, existing, answer: "paste" });
  }

  function onPaste(value: string) {
    setPasted(value);
    setError(null);
    if (!value.trim()) return;
    const read = parseContentPlan(value);
    if (read.ok) review(read.ideas);
    else setError(p.pasteErrors[read.error]);
  }

  function runBuiltin() {
    if (!topicOk) return setError(a.errors.topic);
    setError(null);
    setSeconds(0);
    startWork(async () => {
      const result = await aiProposePlan({ siteId: site.id, locale, topic, count });
      if (result.ok) review(result.ideas);
      else setError(result.error);
    });
  }

  const kept = ideas?.filter((i) => i.keep) ?? [];
  const dates = planDates(start, kept.length, cadence);
  const dayOf = (idea: Idea) => dates[kept.indexOf(idea)];
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(t.common.dateLocale, { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  const update = (idea: Idea, change: Partial<Idea>) => setIdeas((list) => list?.map((i) => (i === idea ? { ...i, ...change } : i)) ?? null);

  function create() {
    setError(null);
    startWork(async () => {
      const result = await createPlannedPosts({
        siteId: site.id,
        locale,
        ideas: kept.map((i, n) => ({ title: i.title, focusKeyword: i.focusKeyword, categoryId: i.categoryId, pillar: i.pillar, plannedFor: dates[n], why: i.why, outline: i.outline })),
      });
      if (!result.ok) return setError(result.error);
      onClose();
      router.push(`/admin/calendar?month=${dates[0].slice(0, 7)}&site=${encodeURIComponent(site.id)}`);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[6vh]" onMouseDown={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-plan-dialog
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Sparkles className="size-4 text-brand" />
              {p.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{p.subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label={t.common.close} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>

        {ideas === null ? (
          <fieldset disabled={running} className="mt-5 flex min-w-0 flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {sites.length > 1 && (
                <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                  {p.site}
                  <select value={site.id} onChange={(e) => setSiteId(e.target.value)} className={inputClass}>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                {p.language}
                <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className={inputClass}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {t.common.locales[l]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
              {p.topic}
              <textarea
                rows={2}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={p.topicPlaceholder}
                className={cn(inputClass, "resize-none")}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                {p.count}
                <input
                  type="number"
                  min={1}
                  max={MAX_PLAN_ARTICLES}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(MAX_PLAN_ARTICLES, Number(e.target.value) || 1)))}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                {p.start}
                <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                {p.cadence}
                <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)} className={inputClass}>
                  {CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {p.cadences[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="-mt-1 text-xs text-zinc-500">{p.cadenceHint}</p>

            <AiEnginePanel
              engine={engine}
              onEngine={(e) => (setEngine(e), setError(null))}
              aiEnabled={aiEnabled}
              buildPrompt={buildPrompt}
              pasted={pasted}
              onPaste={onPaste}
              pastePlaceholder={p.pastePlaceholder}
            />
          </fieldset>
        ) : (
          <div className="mt-5" data-plan-review>
            <p className="text-sm font-semibold text-ink">{fmt(p.review, { n: ideas.length })}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{p.reviewHint}</p>
            <ol className="mt-3 flex flex-col gap-2.5">
              {ideas.map((idea, n) => {
                const day = idea.keep ? dayOf(idea) : null;
                const duplicate = existingSlugs.has(slugify(idea.title));
                return (
                  <li key={n} data-idea={n} className={cn("rounded-xl border p-3.5", idea.keep ? "border-brand-light bg-brand-soft/30" : "border-zinc-200 opacity-60")}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={idea.keep} aria-label={idea.title} onChange={() => update(idea, { keep: !idea.keep })} className="mt-2.5 size-4 accent-brand" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {day && (
                            <span data-day={day} className="rounded-full bg-white px-2 py-0.5 font-semibold text-brand ring-1 ring-brand-light">
                              {dayLabel(day)}
                            </span>
                          )}
                          {idea.pillar && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">
                              <Star className="size-3" />
                              {p.pillar}
                            </span>
                          )}
                          {duplicate && (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <AlertTriangle className="size-3" />
                              {p.duplicate}
                            </span>
                          )}
                        </div>
                        <input
                          value={idea.title}
                          aria-label={t.editor.header.untitled}
                          onChange={(e) => update(idea, { title: e.target.value })}
                          className={cn(inputClass, "mt-1.5 font-semibold")}
                        />
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
                            {p.keyword}
                            <input value={idea.focusKeyword} onChange={(e) => update(idea, { focusKeyword: e.target.value })} className={cn(inputClass, "py-1.5 text-xs")} />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
                            {p.category}
                            <select value={idea.categoryId ?? ""} onChange={(e) => update(idea, { categoryId: e.target.value || null })} className={cn(inputClass, "py-1.5 text-xs")}>
                              <option value="">{p.noCategory}</option>
                              {site.categories.map((c, i) => (
                                <option key={c.id} value={c.id}>
                                  {categoryNames[i]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {idea.why && (
                          <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                            <span className="font-semibold">{p.why}:</span> {idea.why}
                          </p>
                        )}
                        {idea.outline.length > 0 && (
                          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                            <span className="font-semibold">{p.outline}:</span> {idea.outline.join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        {running && ideas === null && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="size-4 animate-spin text-brand" />
            {fmt(p.working, { seconds })}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {ideas !== null && (
            <button type="button" onClick={() => (setIdeas(null), setPasted(""))} disabled={running} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
              <RotateCcw className="size-3.5" />
              {p.back}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={running} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">
            {t.common.cancel}
          </button>
          {ideas !== null ? (
            <button type="button" disabled={running || kept.length === 0 || kept.some((i) => !i.title.trim())} onClick={create} className={primaryButton}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
              {fmt(p.create, { n: kept.length })}
            </button>
          ) : engine === "builtin" ? (
            <button type="button" disabled={running || !aiEnabled || !topicOk} onClick={runBuiltin} className={primaryButton}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {p.suggest}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
