"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Loader2, Pencil } from "lucide-react";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { BRIEF_FIELDS, MAX_BRIEF_FIELD_CHARS, MAX_POSTS_PER_WEEK, hasBrief, type ContentBrief } from "@/lib/ai-brief";
import { cn } from "@/lib/utils";
import { saveBrief } from "./actions";

type Props = {
  siteId: string;
  brief: ContentBrief;
  postsPerWeek: number | null;
  canEdit: boolean;
  /** Opened from "Write the brief" in the next steps. */
  startEditing: boolean;
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20";

/** Sent by the next steps' buttons: open the brief's form on one of its fields. */
const OPEN_BRIEF_EVENT = "overview:open-brief";
type BriefInput = (typeof BRIEF_FIELDS)[number] | "postsPerWeek";

/**
 * "Write the brief" / "Set a target" in the next steps. A button rather than a link: the page
 * address may already be the one a link would go to, and then nothing would open.
 */
export function OpenBriefButton({ field, children }: { field: BriefInput; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-open-brief
      onClick={() => window.dispatchEvent(new CustomEvent<BriefInput>(OPEN_BRIEF_EVENT, { detail: field }))}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-brand hover:text-brand-hover"
    >
      {children} <ArrowRight className="size-3" />
    </button>
  );
}

/** What the blog is for: read by everyone, edited by editors and admins. */
export function BriefCard({ siteId, brief, postsPerWeek, canEdit, startEditing }: Props) {
  const { t } = useI18n();
  const b = t.overview.brief;
  const router = useRouter();
  const [editing, setEditing] = useState(canEdit && startEditing);
  // The field a next-step button asked for, focused once the form shows.
  const [focus, setFocus] = useState<BriefInput | null>(null);
  const [draft, setDraft] = useState(() => Object.fromEntries(BRIEF_FIELDS.map((f) => [f, brief[f] ?? ""])) as Record<(typeof BRIEF_FIELDS)[number], string>);
  const [target, setTarget] = useState(postsPerWeek ? String(postsPerWeek) : "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!canEdit) return;
    const open = (e: Event) => {
      setEditing(true);
      setMessage(null);
      setFocus((e as CustomEvent<BriefInput>).detail);
    };
    window.addEventListener(OPEN_BRIEF_EVENT, open);
    return () => window.removeEventListener(OPEN_BRIEF_EVENT, open);
  }, [canEdit]);

  useEffect(() => {
    if (!editing || !focus) return;
    const el = document.querySelector<HTMLElement>(`[data-brief] [name="${focus}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }, [editing, focus]);

  function save() {
    setMessage(null);
    startSaving(async () => {
      const result = await saveBrief({ siteId, brief: draft, postsPerWeek: target ? Number(target) : null });
      if (!result.ok) return setMessage({ ok: false, text: result.error });
      setEditing(false);
      setFocus(null);
      setMessage({ ok: true, text: b.saved });
      router.refresh();
    });
  }

  return (
    <section id="brief" data-brief className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">{b.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{b.hint}</p>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            data-brief-edit
            onClick={() => (setEditing(true), setMessage(null))}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-brand-light hover:text-brand"
          >
            <Pencil className="size-3.5" />
            {b.edit}
          </button>
        )}
      </div>

      {!editing && !hasBrief(brief) && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {b.missing}
        </p>
      )}

      {editing ? (
        <fieldset disabled={saving} className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
          {BRIEF_FIELDS.map((f) => (
            <label key={f} className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
              {b.fields[f].label}
              <textarea
                name={f}
                rows={3}
                value={draft[f]}
                maxLength={MAX_BRIEF_FIELD_CHARS}
                onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                placeholder={b.fields[f].placeholder}
                className={cn(inputClass, "resize-y font-normal")}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
            {b.postsPerWeek}
            <input
              type="number"
              name="postsPerWeek"
              min={1}
              max={MAX_POSTS_PER_WEEK}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={b.noTarget}
              className={cn(inputClass, "max-w-40 font-normal")}
            />
            <span className="text-xs font-normal text-zinc-500">{b.postsPerWeekHint}</span>
          </label>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => (setEditing(false), setMessage(null))} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
              {t.common.cancel}
            </button>
            <button type="button" data-brief-save onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {b.save}
            </button>
          </div>
        </fieldset>
      ) : (
        <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {BRIEF_FIELDS.map((f) => (
            <div key={f} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{b.fields[f].label}</dt>
              <dd className={cn("mt-1 whitespace-pre-line break-words text-sm leading-relaxed", brief[f] ? "text-zinc-800" : "italic text-zinc-400")}>
                {brief[f] || b.empty}
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{b.postsPerWeek}</dt>
            <dd className={cn("mt-1 text-sm", postsPerWeek ? "font-semibold text-ink" : "italic text-zinc-400")}>
              {postsPerWeek ? fmt(b.perWeek, { n: postsPerWeek }) : b.noTarget}
            </dd>
          </div>
        </dl>
      )}

      {!canEdit && <p className="mt-4 text-xs text-zinc-500">{b.readOnly}</p>}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={cn("mt-4 flex items-start gap-2 rounded-md px-3 py-2 text-sm", message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
          {message.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
          {message.text}
        </p>
      )}
    </section>
  );
}
