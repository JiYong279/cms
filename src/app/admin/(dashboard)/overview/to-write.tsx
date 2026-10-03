import Link from "next/link";
import { ArrowRight, CalendarDays, PenLine, Sparkles } from "lucide-react";
import type { Locale } from "@/db/schema";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import { daysBetween } from "@/lib/days";
import { cn } from "@/lib/utils";
import { PlanWithAiButton, type PlanSite } from "../calendar/plan-dialog";
import { formatShortDay } from "./format";

/** How many articles the list shows; the calendar holds the rest. */
const SHOWN_ARTICLES = 6;

export type ArticleToWrite = {
  postId: string;
  locale: Locale;
  title: string;
  category: string | null;
  plannedFor: string;
  inReview: boolean;
  /** Only the plan's outline so far: the AI writes the draft from it. */
  outlineOnly: boolean;
};

type Props = {
  articles: ArticleToWrite[];
  siteId: string;
  today: string;
  plan: { site: PlanSite; startDay: string; aiEnabled: boolean } | null;
};

/** The day's work: articles planned for the coming week (and late ones), each one click from the AI. */
export async function ToWrite({ articles, siteId, today, plan }: Props) {
  const t = await getT();
  const w = t.overview.toWrite;
  const shown = articles.slice(0, SHOWN_ARTICLES);
  const when = (day: string) => {
    const diff = daysBetween(today, day);
    if (diff < 0) return { label: fmt(w.late, { n: -diff }), late: true };
    if (diff === 0) return { label: w.today, late: false };
    if (diff === 1) return { label: w.tomorrow, late: false };
    return { label: formatShortDay(day, t.common.dateLocale), late: false };
  };

  return (
    <section data-to-write className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            <PenLine className="size-4 text-brand" aria-hidden />
            {w.title}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{w.hint}</p>
        </div>
        <Link
          href={`/admin/calendar?site=${encodeURIComponent(siteId)}`}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand hover:text-brand-hover"
        >
          <CalendarDays className="size-3.5" aria-hidden />
          {w.calendar}
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-300 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-700">{w.empty}</p>
            <p className="text-xs text-zinc-500">{w.emptyHint}</p>
          </div>
          {plan && <PlanWithAiButton sites={[plan.site]} defaultSiteId={plan.site.id} startDay={plan.startDay} aiEnabled={plan.aiEnabled} />}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {shown.map((a) => {
            const day = when(a.plannedFor);
            const href = `/admin/posts/${a.postId}?locale=${a.locale}`;
            return (
              <li key={a.postId} data-article={a.postId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span
                  className={cn(
                    "w-24 shrink-0 text-xs font-semibold",
                    day.late ? "text-red-600" : day.label === w.today ? "text-brand" : "text-zinc-500",
                  )}
                >
                  {day.label}
                </span>
                <span className="min-w-0 flex-1 basis-56">
                  <Link href={href} className="block truncate text-sm font-medium text-ink hover:text-brand">
                    {a.title || t.overview.todo.untitled}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {[a.category, a.inReview ? w.inReview : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {a.outlineOnly && !a.inReview ? (
                  <Link
                    href={`${href}&ai=draft`}
                    data-write-ai
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {w.write}
                  </Link>
                ) : (
                  <Link
                    href={href}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-brand-light hover:text-brand"
                  >
                    {w.open}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {articles.length > SHOWN_ARTICLES && <p className="mt-2 text-xs text-zinc-500">{fmt(w.more, { n: articles.length - SHOWN_ARTICLES })}</p>}
    </section>
  );
}
