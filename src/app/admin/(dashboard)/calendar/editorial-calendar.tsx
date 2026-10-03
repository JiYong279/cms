"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarX2, CheckCircle2, Loader2, Lock, X, XCircle } from "lucide-react";
import type { Locale, PostStatus } from "@/db/schema";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { planPost } from "../../posts/planning-actions";
import { reschedulePost } from "./schedule-actions";

/** One card on the calendar: an article's live versions on one day, or its versions waiting for their planned day. */
export type CalendarEntry = {
  id: string;
  postId: string;
  title: string;
  href: string;
  /** YYYY-MM-DD in the viewer's time zone; null for a draft with no planned day yet. */
  day: string | null;
  /** Time of day for published and scheduled versions. */
  time: string | null;
  status: PostStatus;
  locales: Locale[];
  /** Placed by the article's planned day, not by a publishing date. */
  planned: boolean;
  /** Why the card cannot be dragged to another day; null when it can. */
  lock: "published" | "notAllowed" | null;
  site: string;
  assignee: string | null;
};

type Props = {
  weeks: string[][];
  month: string;
  today: string;
  weekdays: string[];
  entries: CalendarEntry[];
  showSite: boolean;
};

const STATUS_STYLE: Record<PostStatus, { card: string; dot: string }> = {
  published: { card: "border-l-emerald-500 bg-emerald-50/70", dot: "bg-emerald-500" },
  scheduled: { card: "border-l-sky-500 bg-sky-50/70", dot: "bg-sky-500" },
  in_review: { card: "border-l-amber-500 bg-amber-50/70", dot: "bg-amber-500" },
  draft: { card: "border-l-zinc-400 bg-zinc-50", dot: "bg-zinc-400" },
  archived: { card: "border-l-zinc-300 bg-zinc-50", dot: "bg-zinc-300" },
};
const LEGEND: PostStatus[] = ["published", "scheduled", "in_review", "draft"];
/** Drop target that removes the planned day. */
const UNPLANNED = "unplanned";
/** How long a confirmation stays on screen; problems stay until closed. */
const NOTICE_MS = 6000;

type Notice = { tone: "ok" | "error" | "locked"; text: string };

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Orders a day's cards: by time for published and scheduled ones, planned drafts last. */
function byTime(a: CalendarEntry, b: CalendarEntry) {
  if (a.planned !== b.planned) return a.planned ? 1 : -1;
  return (a.time ?? "").localeCompare(b.time ?? "");
}

export function EditorialCalendar({ weeks, month, today, weekdays, entries, showSite }: Props) {
  const { t } = useI18n();
  const c = t.posts.calendar;
  // Days changed here (by card), shown at once while the server saves them.
  const [moved, setMoved] = useState<Map<string, string | null>>(new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const placed = entries.map((e) => (moved.has(e.id) ? { ...e, day: moved.get(e.id) ?? null } : e));
  const onDay = (day: string) => placed.filter((e) => e.day === day).sort(byTime);
  const unplanned = placed.filter((e) => e.day === null);
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(t.common.dateLocale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

  /** Why a card does not move, said when someone tries to drag it. */
  function lockedText(e: CalendarEntry) {
    const title = e.title || c.untitled;
    if (e.lock === "published") return fmt(c.lockedPublished, { title });
    return e.planned ? t.posts.errors.notAllowedEdit : fmt(c.lockedScheduled, { title });
  }

  function move(id: string, day: string | null) {
    const entry = placed.find((e) => e.id === id);
    if (!entry || entry.lock || entry.day === day) return;
    const title = entry.title || c.untitled;
    // A scheduled article needs a day, and one still to come.
    const from = entry.planned ? null : entry.day;
    if (!entry.planned && (!from || !day)) {
      setNotice({ tone: "error", text: c.scheduledNeedsDay });
      return;
    }
    if (from && day && day < today) {
      setNotice({ tone: "error", text: t.posts.errors.pastSchedule });
      return;
    }

    const forget = () =>
      setMoved((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
    setMoved((m) => new Map(m).set(id, day));
    setNotice(null);
    start(async () => {
      if (from && day) {
        const result = await reschedulePost({ postId: entry.postId, from, to: day });
        // The page comes back with the card under its new day (and a new id): nothing to hold.
        forget();
        setNotice(result.ok ? { tone: "ok", text: fmt(c.rescheduled, { title, date: dayLabel(day), time: entry.time ?? "" }) } : { tone: "error", text: result.error });
        return;
      }
      const result = await planPost({ postId: entry.postId, plannedFor: day });
      if (result.ok) {
        setNotice({ tone: "ok", text: day ? fmt(c.moved, { title, date: dayLabel(day) }) : fmt(c.unplannedDone, { title }) });
      } else {
        forget();
        setNotice({ tone: "error", text: result.error });
      }
    });
  }

  /** Props that make an element accept a dragged card. */
  const dropTarget = (target: string) => ({
    "data-drop": target,
    onDragOver: (e: React.DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== target) setOver(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === target ? null : o));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragging) move(dragging, target === UNPLANNED ? null : target);
      setDragging(null);
      setOver(null);
    },
  });

  const card = (e: CalendarEntry, compact: boolean) => (
    <Link
      key={e.id}
      href={e.href}
      // Every card can be picked up, so a locked one can say why it stays.
      draggable
      data-entry={e.id}
      data-post-id={e.postId}
      data-day={e.day ?? ""}
      data-status={e.status}
      data-lock={e.lock ?? undefined}
      onDragStart={(ev) => {
        if (e.lock) {
          ev.preventDefault();
          setNotice({ tone: "locked", text: lockedText(e) });
          return;
        }
        ev.dataTransfer.effectAllowed = "move";
        // Firefox starts a drag only when some data is set.
        ev.dataTransfer.setData("text/plain", e.postId);
        setDragging(e.id);
      }}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
      title={e.title || c.untitled}
      className={cn(
        "group block rounded-md border border-zinc-200 border-l-[3px] px-2 py-1.5 text-left shadow-xs transition hover:border-zinc-300 hover:shadow-sm",
        STATUS_STYLE[e.status].card,
        !e.lock && "cursor-grab active:cursor-grabbing",
        dragging === e.id && "opacity-40",
      )}
    >
      <span className={cn("block font-medium leading-snug text-zinc-800 [overflow-wrap:anywhere]", compact ? "line-clamp-2 text-xs" : "text-sm")}>
        {e.title || <span className="italic text-zinc-400">{c.untitled}</span>}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
        <span className="font-medium tabular-nums">{e.planned ? c.planned : e.time}</span>
        {e.locales.map((l) => (
          <span key={l} className="rounded bg-white/80 px-1 font-semibold uppercase text-zinc-600 ring-1 ring-zinc-200">
            {l}
          </span>
        ))}
        {showSite && <span className="truncate">{e.site}</span>}
        {e.assignee && (
          <span
            title={fmt(c.assignee, { name: e.assignee })}
            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-[9px] font-semibold text-white"
          >
            {initials(e.assignee)}
          </span>
        )}
      </span>
    </Link>
  );

  const agendaDays = weeks.flat().filter((day) => day.startsWith(month) && onDay(day).length > 0);

  return (
    <div className="lg:grid lg:grid-cols-[1fr_15rem]">
      <div className="min-w-0">
        {/* Month grid (tablets and up): drag drafts between days. */}
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {weekdays.map((w) => (
              <div key={w} className="py-2">
                {w}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b border-zinc-100 last:border-b-0">
              {week.map((day) => {
                const inMonth = day.startsWith(month);
                return (
                  <div
                    key={day}
                    {...dropTarget(day)}
                    data-calendar-day={day}
                    className={cn(
                      "flex min-h-28 min-w-0 flex-col gap-1 border-r border-zinc-100 p-1.5 last:border-r-0",
                      !inMonth && "bg-zinc-50/70",
                      over === day && "bg-brand-tint/60 ring-2 ring-inset ring-brand-light",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center self-end rounded-full text-xs tabular-nums",
                        day === today ? "bg-brand font-semibold text-white" : inMonth ? "text-zinc-600" : "text-zinc-300",
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>
                    {onDay(day).map((e) => card(e, true))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Phones: the month's days that have articles, as a list. */}
        <div className="sm:hidden">
          {agendaDays.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">{c.emptyMonth}</p>
          ) : (
            <ol className="divide-y divide-zinc-100">
              {agendaDays.map((day) => (
                <li key={day} className="px-4 py-3">
                  <p className={cn("mb-2 text-xs font-semibold", day === today ? "text-brand" : "text-zinc-500")}>{dayLabel(day)}</p>
                  <div className="flex flex-col gap-1.5">{onDay(day).map((e) => card(e, false))}</div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200 px-4 py-2.5 text-xs text-zinc-500">
          <span className="font-medium">{c.legend}:</span>
          {LEGEND.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", STATUS_STYLE[s].dot)} />
              {t.common.status[s]}
            </span>
          ))}
          {pending && <Loader2 className="ml-auto size-3.5 animate-spin" aria-hidden />}
        </div>
      </div>

      {/* Floats over the page, so it shows wherever the card was dropped. */}
      {notice && (
        <div
          role="status"
          data-notice={notice.tone}
          className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 items-start gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-2xl"
        >
          {notice.tone === "ok" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          ) : notice.tone === "locked" ? (
            <Lock className="mt-0.5 size-4 shrink-0 text-amber-300" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
          )}
          <span className="flex-1 leading-relaxed">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t.common.close} className="text-white/50 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      )}

      <aside
        {...dropTarget(UNPLANNED)}
        aria-label={c.unplanned}
        className={cn(
          "border-t border-zinc-200 p-3 lg:border-l lg:border-t-0",
          over === UNPLANNED && "bg-brand-tint/60 ring-2 ring-inset ring-brand-light",
        )}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarX2 className="size-4 text-zinc-400" />
          {c.unplanned}
          <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] font-semibold tabular-nums text-zinc-500">{unplanned.length}</span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{c.unplannedHint}</p>
        <div className="mt-3 flex flex-col gap-1.5" data-unplanned-list>
          {unplanned.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">
              {dragging ? c.dropHere : c.unplannedEmpty}
            </p>
          ) : (
            unplanned.map((e) => card(e, false))
          )}
        </div>
      </aside>
    </div>
  );
}
