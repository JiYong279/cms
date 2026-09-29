"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarX2, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { Locale, PostStatus } from "@/db/schema";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { planPost } from "../../posts/planning-actions";

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
  /** Placed by the article's planned day (it moves when dragged), not by a publishing date. */
  planned: boolean;
  movable: boolean;
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
  // Days changed here, shown at once while the server saves them.
  const [moved, setMoved] = useState<Map<string, string | null>>(new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const placed = entries.map((e) => (e.movable && moved.has(e.postId) ? { ...e, day: moved.get(e.postId) ?? null } : e));
  const onDay = (day: string) => placed.filter((e) => e.day === day).sort(byTime);
  const unplanned = placed.filter((e) => e.day === null);
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(t.common.dateLocale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

  function move(postId: string, day: string | null) {
    const entry = placed.find((e) => e.postId === postId && e.movable);
    if (!entry || entry.day === day) return;
    const title = entry.title || c.untitled;
    setMoved((m) => new Map(m).set(postId, day));
    setNotice(null);
    start(async () => {
      const result = await planPost({ postId, plannedFor: day });
      if (result.ok) {
        setNotice({ ok: true, text: day ? fmt(c.moved, { title, date: dayLabel(day) }) : fmt(c.unplannedDone, { title }) });
      } else {
        setMoved((m) => {
          const next = new Map(m);
          next.delete(postId);
          return next;
        });
        setNotice({ ok: false, text: result.error });
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
      draggable={e.movable}
      data-entry={e.id}
      data-post-id={e.postId}
      data-day={e.day ?? ""}
      data-status={e.status}
      onDragStart={(ev) => {
        if (!e.movable) return;
        ev.dataTransfer.effectAllowed = "move";
        // Firefox starts a drag only when some data is set.
        ev.dataTransfer.setData("text/plain", e.postId);
        setDragging(e.postId);
      }}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
      title={e.title || c.untitled}
      className={cn(
        "group block rounded-md border border-zinc-200 border-l-[3px] px-2 py-1.5 text-left shadow-xs transition hover:border-zinc-300 hover:shadow-sm",
        STATUS_STYLE[e.status].card,
        e.movable && "cursor-grab active:cursor-grabbing",
        dragging === e.postId && e.movable && "opacity-40",
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
          <span role="status" className="ml-auto flex items-center gap-1.5">
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : notice ? (
              <>
                {notice.ok ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <XCircle className="size-3.5 text-red-500" />}
                <span className={notice.ok ? "text-zinc-600" : "text-red-600"}>{notice.text}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>

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
