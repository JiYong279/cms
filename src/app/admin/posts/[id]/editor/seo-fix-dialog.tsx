"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { AlertTriangle, Check, CircleAlert, CircleCheck, Copy, ExternalLink, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import type { Locale } from "@/db/schema";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { AI_FIELDS, LIMITS, parseSeoFix, seoFixPrompt, suggestSlug, withinLimits, type AiField, type FixArticle, type FixField } from "@/lib/seo-fix";
import { cn } from "@/lib/utils";
import { aiFixSeo } from "../../ai-actions";

type Props = {
  postId: string;
  locale: Locale;
  site: { id: string; name: string; baseUrl: string };
  /** The built-in AI has an API key. */
  enabled: boolean;
  /** Fields ticked at first: those fixing the checks the person clicked. */
  initial: FixField[];
  /** The article as it is in the editor now. */
  article: FixArticle & { slug: string };
  onApply: (values: Partial<Record<FixField, string>>) => void;
  onClose: () => void;
};

const ALL_FIELDS: FixField[] = [...AI_FIELDS, "slug"];
const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20";

/**
 * "Fix with AI" for the SEO score: the AI (built in, or the person's own Claude through copy and
 * paste) rewrites the chosen fields; each suggestion is shown next to the current value, with its
 * length, to be used or dropped. Nothing is saved: the fields go into the editor like typing would.
 */
export function SeoFixDialog({ postId, locale, site, enabled, initial, article, onApply, onClose }: Props) {
  const { t } = useI18n();
  const a = t.editor.ai;
  const f = t.editor.seoFix;
  const titleId = useId();
  const [engine, setEngine] = useState<"own" | "builtin">(enabled ? "builtin" : "own");
  const [chosen, setChosen] = useState<FixField[]>(initial.length ? initial : ["metaTitle", "metaDescription"]);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);
  const [pasted, setPasted] = useState("");
  const [proposals, setProposals] = useState<Partial<Record<FixField, string>> | null>(null);
  const [use, setUse] = useState<FixField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, start] = useTransition();
  const [seconds, setSeconds] = useState(0);

  const aiFields = AI_FIELDS.filter((x) => chosen.includes(x));
  const current: Record<FixField, string> = {
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    excerpt: article.excerpt,
    focusKeyword: article.focusKeyword,
    slug: article.slug,
  };

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

  /** Shows the AI's values (and the slug made from the search phrase), ticking those of the right length. */
  function propose(values: Partial<Record<AiField, string>>) {
    const next: Partial<Record<FixField, string>> = { ...values };
    if (chosen.includes("slug")) {
      const slug = suggestSlug(values.focusKeyword ?? article.focusKeyword);
      if (slug) next.slug = slug;
    }
    setProposals(next);
    setUse(ALL_FIELDS.filter((x) => next[x] !== undefined && withinLimits(x, next[x] ?? "")));
  }

  function toggle(list: FixField[], field: FixField) {
    return list.includes(field) ? list.filter((x) => x !== field) : [...list, field];
  }

  function copyPrompt() {
    const text = seoFixPrompt({ site, locale, fields: aiFields, article, answer: "paste" });
    setPrompt(text);
    navigator.clipboard.writeText(text).then(
      () => setCopied("yes"),
      // No clipboard access (e.g. a plain-http address): the prompt is shown to copy by hand.
      () => setCopied("manual"),
    );
  }

  function onPaste(value: string) {
    setPasted(value);
    setError(null);
    if (!value.trim()) return;
    const read = parseSeoFix(value, aiFields);
    if (read.ok) propose(read.values);
    else setError(f.pasteErrors[read.error]);
  }

  function runBuiltin() {
    setError(null);
    setSeconds(0);
    start(async () => {
      const { title, excerpt, metaTitle, metaDescription, focusKeyword, html } = article;
      const result = await aiFixSeo({ postId, locale, fields: aiFields, article: { title, excerpt, metaTitle, metaDescription, focusKeyword, html } });
      if (result.ok) propose(result.values);
      else setError(result.error);
    });
  }

  const lengthNote = (field: FixField, value: string) => {
    const n = value.trim().length;
    if (field === "slug") return fmt(f.chars, { n });
    const { min, max } = LIMITS[field];
    return `${fmt(f.chars, { n })} · ${min === undefined ? fmt(f.upTo, { max }) : fmt(f.range, { min, max })}`;
  };
  const primaryButton =
    "inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[8vh]" onMouseDown={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-seo-fix
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Sparkles className="size-4 text-brand" />
              {f.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{f.subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label={t.common.close} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>

        {proposals === null ? (
          <>
            <fieldset className="mt-5" disabled={running}>
              <legend className="text-sm font-semibold text-ink">{f.fieldsLabel}</legend>
              <div className="mt-2 flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                {ALL_FIELDS.map((field) => (
                  <label key={field} className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.includes(field)}
                      data-field={field}
                      onChange={() => {
                        setChosen((c) => toggle(c, field));
                        setPrompt("");
                        setCopied(null);
                        setPasted("");
                        setError(null);
                      }}
                      className="mt-0.5 size-4 accent-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-zinc-800">{f.fields[field]}</span>
                        <span className={cn("shrink-0 text-xs", withinLimits(field, current[field]) ? "text-zinc-400" : "text-amber-600")}>
                          {field === "slug" ? f.slugNote : lengthNote(field, current[field])}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">{current[field] || f.empty}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {aiFields.length > 0 && (
              <>
                <div className="mt-5 flex rounded-lg bg-zinc-100 p-1" role="radiogroup" aria-label={a.engine}>
                  {(["own", "builtin"] as const).map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="radio"
                      aria-checked={engine === e}
                      disabled={running}
                      onClick={() => {
                        setEngine(e);
                        setError(null);
                      }}
                      className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition", engine === e ? "bg-white text-ink shadow-sm" : "text-zinc-500 hover:text-zinc-800")}
                    >
                      {e === "own" ? a.engineOwn : a.engineBuiltin}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-zinc-500">{engine === "own" ? a.engineOwnHint : enabled ? a.engineBuiltinHint : a.errors.not_configured}</p>

                {engine === "own" && (
                  <div className="mt-4 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={copyPrompt}
                        className="inline-flex items-center gap-2 rounded-lg border border-brand px-3.5 py-2 text-sm font-semibold text-brand hover:bg-brand-soft"
                      >
                        <Copy className="size-4" />
                        {a.copyPrompt}
                      </button>
                      <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-hover">
                        {f.openClaude}
                        <ExternalLink className="size-3.5" />
                      </a>
                      {copied === "yes" && (
                        <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <Check className="size-3.5" />
                          {a.copied}
                        </span>
                      )}
                    </div>
                    {prompt && (
                      <details open={copied === "manual"} className="rounded-lg border border-zinc-200 bg-zinc-50 text-xs">
                        <summary className="cursor-pointer px-3 py-2 font-medium text-zinc-600">{copied === "manual" ? a.copyFailed : a.showPrompt}</summary>
                        <textarea
                          readOnly
                          value={prompt}
                          rows={6}
                          aria-label={a.showPrompt}
                          onFocus={(e) => e.currentTarget.select()}
                          className="block w-full resize-y border-t border-zinc-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-700 outline-none"
                        />
                      </details>
                    )}
                    <textarea
                      rows={4}
                      value={pasted}
                      onChange={(e) => onPaste(e.target.value)}
                      placeholder={f.pastePlaceholder}
                      aria-label={a.step2}
                      className={cn(inputClass, "resize-y font-mono text-xs")}
                    />
                    <p className="-mt-1 text-xs text-zinc-500">{a.step2Hint}</p>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div className="mt-5 flex flex-col gap-3" data-proposals>
            <p className="text-sm font-semibold text-ink">{f.proposals}</p>
            {ALL_FIELDS.filter((field) => proposals[field] !== undefined).map((field) => {
              const value = proposals[field] ?? "";
              const ok = withinLimits(field, value);
              return (
                <div key={field} data-proposal={field} className={cn("rounded-xl border p-3.5", use.includes(field) ? "border-brand-light bg-brand-soft/40" : "border-zinc-200")}>
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium text-zinc-800">
                      <input type="checkbox" checked={use.includes(field)} onChange={() => setUse((u) => toggle(u, field))} className="size-4 accent-brand" />
                      {f.use} · {f.fields[field]}
                    </span>
                    <span className={cn("text-xs", ok ? "text-emerald-700" : "text-amber-600")}>{lengthNote(field, value)}</span>
                  </label>
                  <p className="mt-2 text-xs text-zinc-400 line-through decoration-zinc-300">
                    {f.now}: {current[field] || f.empty}
                  </p>
                  <textarea
                    rows={field === "metaDescription" || field === "excerpt" ? 3 : 1}
                    value={value}
                    aria-label={f.fields[field]}
                    onChange={(e) => setProposals((p) => ({ ...p, [field]: e.target.value }))}
                    className={cn(inputClass, "mt-1.5 resize-y", field === "slug" && "font-mono text-xs")}
                  />
                  {!ok && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {f.outOfRange}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        {running && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="size-4 animate-spin text-brand" />
            {fmt(f.working, { seconds })}
          </p>
        )}
        {proposals === null && chosen.length === 0 && <p className="mt-3 text-xs text-amber-700">{f.noneSelected}</p>}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {proposals !== null && (
            <button type="button" onClick={() => (setProposals(null), setPasted(""))} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
              <RotateCcw className="size-3.5" />
              {f.again}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={running} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">
            {t.common.cancel}
          </button>
          {proposals !== null ? (
            <button
              type="button"
              disabled={use.length === 0}
              onClick={() => onApply(Object.fromEntries(use.map((field) => [field, (proposals[field] ?? "").trim()])))}
              className={primaryButton}
            >
              <CircleCheck className="size-4" />
              {fmt(f.apply, { n: use.length })}
            </button>
          ) : aiFields.length === 0 ? (
            <button type="button" disabled={chosen.length === 0} onClick={() => propose({})} className={primaryButton}>
              <Sparkles className="size-4" />
              {f.suggest}
            </button>
          ) : engine === "builtin" ? (
            <button type="button" disabled={running || !enabled} onClick={runBuiltin} className={primaryButton}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {f.suggest}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
