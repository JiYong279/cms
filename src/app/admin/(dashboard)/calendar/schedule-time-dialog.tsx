"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { CalendarClock, CircleAlert, Loader2, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { setScheduleTime } from "./schedule-actions";

/** The value of a datetime-local input for an instant, in the browser's time zone. */
function toLocalInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type Props = {
  entry: { postId: string; title: string; day: string; at: string };
  onClose: () => void;
  /** Called after the server saved the new moment. */
  onSaved: (at: Date) => void;
};

/** "Change publishing date and time" for a scheduled card on the editorial calendar. */
export function ScheduleTimeDialog({ entry, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const c = t.posts.calendar;
  const titleId = useId();
  const [value, setValue] = useState(() => toLocalInput(new Date(entry.at)));
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  // Earliest choice: the next minute.
  const [min] = useState(() => toLocalInput(new Date(Date.now() + 60_000)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  function save() {
    // The input is read in the browser's time zone, like the editor's "Publish at".
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return setError(t.posts.errors.invalid);
    setError(null);
    start(async () => {
      const result = await setScheduleTime({ postId: entry.postId, from: entry.day, at: at.toISOString() });
      if (!result.ok) return setError(result.error);
      onSaved(at);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 py-[12vh]" onMouseDown={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-schedule-dialog
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-ink">
              <CalendarClock className="size-4 text-sky-600" />
              {c.retimeTitle}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 [overflow-wrap:anywhere]">{entry.title || c.untitled}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t.common.close} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>

        <label className="mt-5 flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
          {c.retimeLabel}
          <input
            type="datetime-local"
            value={value}
            min={min}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20"
          />
        </label>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">{c.retimeHint}</p>

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !value}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {c.retimeSave}
          </button>
        </div>
      </div>
    </div>
  );
}
