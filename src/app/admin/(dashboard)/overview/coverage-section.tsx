import Link from "next/link";
import { BookOpen, CalendarCheck, Gauge, Layers } from "lucide-react";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import { AVERAGE_WEEKS, MIN_CLUSTER_ARTICLES, type TopicCoverage } from "@/lib/content-overview";
import { cn } from "@/lib/utils";
import { PlanWithAiButton, type PlanSite } from "../calendar/plan-dialog";
import { formatDay, formatMonth } from "./format";

/** Weeks in a month, to turn the weekly target into a monthly one. */
const WEEKS_PER_MONTH = 52 / 12;

type Props = {
  coverage: TopicCoverage[];
  topicNames: Map<string, string>;
  stats: { live: number; liveDetail: string; last30: number; average: number; target: number | null };
  monthly: { month: string; count: number }[];
  /** Where an article opens, or null when the viewer may not open it. */
  postHref: (postId: string) => string | null;
  plan: { site: PlanSite; startDay: string; aiEnabled: boolean } | null;
  /** "Propose categories with AI", for category managers. */
  categoryTool: React.ReactNode;
};

export async function CoverageSection({ coverage, topicNames, stats, monthly, postHref, plan, categoryTool }: Props) {
  const t = await getT();
  const c = t.overview.coverage;
  const topics = coverage.filter((x) => x.categoryId !== null);
  const covered = topics.filter((x) => x.needs.length === 0).length;
  const monthlyTarget = stats.target ? Math.round(stats.target * WEEKS_PER_MONTH) : null;
  const scale = Math.max(1, monthlyTarget ?? 0, ...monthly.map((m) => m.count));

  const cards = [
    { label: c.live, value: String(stats.live), detail: stats.liveDetail, icon: BookOpen },
    { label: c.last30, value: String(stats.last30), detail: "", icon: CalendarCheck },
    {
      label: c.average,
      value: stats.average.toLocaleString(t.common.dateLocale),
      detail: stats.target ? fmt(c.averageHint, { weeks: AVERAGE_WEEKS, target: stats.target }) : fmt(c.averageNoTarget, { weeks: AVERAGE_WEEKS }),
      icon: Gauge,
      warn: !!stats.target && stats.average < stats.target,
    },
    { label: c.topics, value: `${covered}/${topics.length}`, detail: "", icon: Layers, warn: topics.length > 0 && covered < topics.length },
  ];

  return (
    <section data-coverage className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">{c.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{fmt(c.hint, { min: MIN_CLUSTER_ARTICLES })}</p>
        </div>
        {categoryTool}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200 p-3.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", card.warn ? "bg-amber-50 text-amber-600" : "bg-brand-tint text-brand")}>
              <card.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-2xl font-semibold tabular-nums">{card.value}</span>
              <span className="block text-xs text-zinc-500">{card.label}</span>
              {card.detail && <span className="block text-[11px] text-zinc-400">{card.detail}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700">{c.monthly}</h3>
          {monthlyTarget && <span className="text-xs text-zinc-500">{fmt(c.monthlyTarget, { n: monthlyTarget })}</span>}
        </div>
        <div className="relative mt-3 flex h-32 items-end gap-2 border-b border-zinc-200 sm:gap-4" data-monthly>
          {monthlyTarget && (
            <div aria-hidden className="absolute inset-x-0 border-t border-dashed border-brand-light" style={{ bottom: `${(monthlyTarget / scale) * 100}%` }} />
          )}
          {monthly.map((m) => (
            <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-xs font-semibold tabular-nums text-zinc-700">{m.count}</span>
              <div
                className={cn("w-full max-w-12 rounded-t-md", monthlyTarget && m.count < monthlyTarget ? "bg-amber-300" : "bg-brand")}
                style={{ height: `${(m.count / scale) * 100}%`, minHeight: m.count ? 4 : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-2 sm:gap-4">
          {monthly.map((m) => (
            <span key={m.month} className="min-w-0 flex-1 text-center text-[11px] capitalize text-zinc-500">
              {formatMonth(m.month, t.common.dateLocale)}
            </span>
          ))}
        </div>
      </div>

      {topics.length === 0 && <p className="mt-6 rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500">{c.noCategories}</p>}
      {coverage.length > 0 && (
        <div className="relative mt-6 overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full min-w-[46rem] text-left text-sm" data-topics>
            <thead className="bg-zinc-50 text-xs font-semibold text-zinc-500">
              <tr>
                <th scope="col" className="min-w-56 px-3 py-2.5">{c.topic}</th>
                <th scope="col" className="px-3 py-2.5 text-right">{c.liveCol}</th>
                <th scope="col" className="px-3 py-2.5">{c.pillar}</th>
                <th scope="col" className="px-3 py-2.5 text-right">{c.inProgress}</th>
                <th scope="col" className="px-3 py-2.5">{c.latest}</th>
                <th scope="col" className="px-3 py-2.5">{c.status}</th>
                {plan && <th scope="col" className="px-3 py-2.5"><span className="sr-only">{t.overview.next.plan}</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {coverage.map((topic) => {
                const name = topic.categoryId ? (topicNames.get(topic.categoryId) ?? "") : c.uncategorized;
                const pillarHref = topic.pillar ? postHref(topic.pillar.postId) : null;
                const pillarLabel = topic.pillar ? (topic.pillar.live ? c.pillarLive : c.pillarDraft) : c.pillarNone;
                return (
                  <tr key={topic.categoryId ?? "none"} data-topic={topic.categoryId ?? "none"}>
                    <th scope="row" className="px-3 py-3 font-medium text-ink">
                      {name}
                      {topic.categoryId && (
                        <span className="mt-1.5 flex items-center gap-2">
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">
                            <span
                              className={cn("block h-full rounded-full", topic.liveCluster >= MIN_CLUSTER_ARTICLES ? "bg-emerald-500" : "bg-amber-400")}
                              style={{ width: `${Math.min(100, (topic.liveCluster / MIN_CLUSTER_ARTICLES) * 100)}%` }}
                            />
                          </span>
                          <span className="whitespace-nowrap text-[11px] font-normal text-zinc-500">{fmt(c.clusterProgress, { have: topic.liveCluster, min: MIN_CLUSTER_ARTICLES })}</span>
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums">{topic.live}</td>
                    <td className="px-3 py-3">
                      {topic.categoryId === null ? (
                        <span className="text-zinc-400">—</span>
                      ) : pillarHref ? (
                        <Link href={pillarHref} className={cn("font-medium hover:underline", topic.pillar?.live ? "text-emerald-700" : "text-amber-700")}>
                          {pillarLabel}
                        </Link>
                      ) : (
                        <span className={topic.pillar ? "text-amber-700" : "text-zinc-400"}>{pillarLabel}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{topic.inProgress}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-600">{topic.lastPublished ? formatDay(topic.lastPublished, t.common.dateLocale) : c.never}</td>
                    <td className="px-3 py-3">
                      {topic.categoryId === null ? (
                        <span className="text-zinc-400">—</span>
                      ) : topic.needs.length === 0 ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">{c.covered}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {topic.needs.map((need) => (
                            <span key={need} data-need={need} className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                              {c.needs[need]}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    {plan && (
                      <td className="px-3 py-3 text-right">
                        {topic.categoryId && topic.needs.length > 0 && (
                          <PlanWithAiButton sites={[plan.site]} defaultSiteId={plan.site.id} startDay={plan.startDay} aiEnabled={plan.aiEnabled} initialTopic={name} variant="inline" label={t.overview.next.plan} />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
