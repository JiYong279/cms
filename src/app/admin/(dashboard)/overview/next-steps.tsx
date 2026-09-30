import Link from "next/link";
import { ArrowRight, CalendarRange, CheckCircle2, Compass, FolderInput, FolderTree, Languages, Star, Target, TrendingDown, type LucideIcon } from "lucide-react";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import { MIN_CLUSTER_ARTICLES, type NextStep } from "@/lib/content-overview";
import { addDays } from "@/lib/days";
import { PlanWithAiButton, type PlanSite } from "../calendar/plan-dialog";
import { OpenBriefButton } from "./brief-card";
import { formatDay, formatWeek } from "./format";

/** How many steps are shown; the sections below hold the rest. */
const SHOWN_STEPS = 6;

type Props = {
  steps: NextStep[];
  siteId: string;
  topicNames: Map<string, string>;
  canEditBrief: boolean;
  /** The AI category buttons, for category managers only. */
  categoryTools: { suggest: React.ReactNode; place: React.ReactNode } | null;
  /** Present when the viewer may plan articles. */
  plan: { site: PlanSite; startDay: string; aiEnabled: boolean } | null;
};

const ICONS: Record<NextStep["kind"], LucideIcon> = {
  brief: Compass,
  target: Target,
  categories: FolderTree,
  uncategorized: FolderInput,
  pillar: Star,
  thin: TrendingDown,
  week: CalendarRange,
  translate: Languages,
  quiet: TrendingDown,
};

const linkClass = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-brand hover:text-brand-hover";

export async function NextSteps({ steps, siteId, topicNames, canEditBrief, categoryTools, plan }: Props) {
  const t = await getT();
  const n = t.overview.next;
  const site = encodeURIComponent(siteId);

  function describe(step: NextStep): { text: string; action: React.ReactNode } {
    const planButton = (topic: string) =>
      plan && <PlanWithAiButton sites={[plan.site]} defaultSiteId={plan.site.id} startDay={plan.startDay} aiEnabled={plan.aiEnabled} initialTopic={topic} variant="inline" label={n.plan} />;
    switch (step.kind) {
      case "brief":
        return { text: n.brief, action: canEditBrief && <OpenBriefButton field="audience">{n.writeBrief}</OpenBriefButton> };
      case "target":
        return { text: n.target, action: canEditBrief && <OpenBriefButton field="postsPerWeek">{n.setTarget}</OpenBriefButton> };
      case "categories":
        return { text: n.categories, action: categoryTools?.suggest };
      case "uncategorized":
        return { text: fmt(n.uncategorized, { n: step.n }), action: categoryTools?.place };
      case "pillar": {
        const topic = topicNames.get(step.categoryId) ?? "";
        return { text: fmt(n.pillar, { topic }), action: planButton(topic) };
      }
      case "thin": {
        const topic = topicNames.get(step.categoryId) ?? "";
        return { text: fmt(n.thin, { topic, have: step.have, need: MIN_CLUSTER_ARTICLES }), action: planButton(topic) };
      }
      case "quiet": {
        const topic = topicNames.get(step.categoryId) ?? "";
        return { text: fmt(n.quiet, { topic, date: formatDay(step.since, t.common.dateLocale) }), action: planButton(topic) };
      }
      case "week": {
        return {
          text: fmt(n.week, { range: formatWeek(step.start, addDays(step.start, 6), t.common.dateLocale), have: step.have, target: step.target }),
          action: <Link href={`/admin/calendar?site=${site}&month=${step.start.slice(0, 7)}`} className={linkClass}>{n.openCalendar} <ArrowRight className="size-3" /></Link>,
        };
      }
      case "translate":
        return {
          text: fmt(n.translate, { n: step.n, language: t.common.locales[step.missing] }),
          action: <Link href="#languages" className={linkClass}>{n.seeList} <ArrowRight className="size-3" /></Link>,
        };
    }
  }

  const shown = steps.slice(0, SHOWN_STEPS);
  return (
    <section data-next-steps className="rounded-xl border border-brand-light bg-brand-soft/40 p-5 shadow-sm sm:p-6">
      <h2 className="font-semibold text-ink">{n.title}</h2>
      <p className="mt-1 text-sm text-zinc-600">{n.hint}</p>
      {shown.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="size-4" />
          {n.none}
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-2">
          {shown.map((step, i) => {
            const Icon = ICONS[step.kind];
            const { text, action } = describe(step);
            return (
              <li key={i} data-step={step.kind} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5">
                <Icon className="size-4 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 flex-1 basis-56 text-sm text-zinc-800">{text}</span>
                {action}
              </li>
            );
          })}
        </ol>
      )}
      {steps.length > SHOWN_STEPS && <p className="mt-3 text-xs text-zinc-500">{fmt(n.more, { n: steps.length - SHOWN_STEPS })}</p>}
    </section>
  );
}
