import Link from "next/link";
import { ArrowRight, Languages } from "lucide-react";
import type { Locale } from "@/db/schema";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import type { WeekLoad } from "@/lib/content-overview";
import { cn } from "@/lib/utils";
import { formatWeek } from "./format";

/** How many one-language articles are listed. */
const SHOWN_GAPS = 6;

type Gap = { postId: string; title: string; has: Locale; missing: Locale };

type Props = {
  siteId: string;
  weeks: WeekLoad[];
  target: number | null;
  gaps: Gap[];
};

export async function WeeksSection({ siteId, weeks, target, gaps }: Props) {
  const t = await getT();
  const w = t.overview.weeks;
  const l = t.overview.languages;
  const label = (i: number, week: WeekLoad) => (i === 0 ? w.thisWeek : i === 1 ? w.nextWeek : formatWeek(week.start, week.end, t.common.dateLocale));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section data-weeks className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink">{w.title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{w.hint}</p>
          </div>
          <Link href={`/admin/calendar?site=${encodeURIComponent(siteId)}`} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand hover:text-brand-hover">
            {w.openCalendar}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <ol className="mt-4 grid grid-cols-2 gap-3">
          {weeks.map((week, i) => {
            const short = target !== null && week.count < target;
            return (
              <li key={week.start} data-week={week.start} className={cn("rounded-lg border p-3", short ? "border-amber-200 bg-amber-50/60" : target ? "border-emerald-200 bg-emerald-50/50" : "border-zinc-200")}>
                <p className="text-xs font-medium text-zinc-500">{label(i, week)}</p>
                <p className={cn("mt-1 text-lg font-semibold tabular-nums", short ? "text-amber-700" : "text-ink")}>
                  {target ? fmt(w.countTarget, { n: week.count, target }) : fmt(w.count, { n: week.count })}
                </p>
                {i < 2 && <p className="text-[11px] text-zinc-400">{formatWeek(week.start, week.end, t.common.dateLocale)}</p>}
              </li>
            );
          })}
        </ol>
      </section>

      <section id="languages" data-languages className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-semibold text-ink">{l.title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{l.hint}</p>
        {gaps.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{l.none}</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100">
            {gaps.slice(0, SHOWN_GAPS).map((gap) => (
              <li key={gap.postId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1 basis-48">
                  <Link href={`/admin/posts/${gap.postId}?locale=${gap.has}`} className="block truncate text-sm font-medium text-ink hover:text-brand">
                    {gap.title || t.overview.todo.untitled}
                  </Link>
                  <span className="text-xs text-zinc-500">{fmt(l.item, { has: gap.has.toUpperCase(), missing: gap.missing.toUpperCase() })}</span>
                </span>
                <Link
                  // The missing language's editor, translating from the live one (the editor's own convention).
                  href={`/admin/posts/${gap.postId}?locale=${gap.missing}&ai=translate`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-brand-light px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
                >
                  <Languages className="size-3.5" />
                  {l.translate}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {gaps.length > SHOWN_GAPS && <p className="mt-2 text-xs text-zinc-500">{fmt(l.more, { n: gaps.length - SHOWN_GAPS })}</p>}
      </section>
    </div>
  );
}
