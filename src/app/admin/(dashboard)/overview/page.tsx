import Link from "next/link";
import { asc, count, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Locale } from "@/db/schema";
import { getLang, getT, getTimeZone } from "@/i18n/server";
import { aiConfigured } from "@/lib/ai";
import { hasBrief } from "@/lib/ai-brief";
import { scoreVersion } from "@/lib/article-score";
import { requireUser } from "@/lib/auth";
import { categoryName } from "@/lib/categories";
import {
  getLanguageGaps,
  getMonthlyOutput,
  getNextSteps,
  getTodo,
  getTopicCoverage,
  getWeekLoad,
  getWeeklyAverage,
  type OverviewPost,
  type TodoVersion,
} from "@/lib/content-overview";
import { addDays, daysBetween, getDayKey } from "@/lib/days";
import { countImageSuggestions } from "@/lib/image-suggestions";
import { can } from "@/lib/permissions";
import { LOCALES } from "@/lib/posts";
import { publishDuePosts } from "@/lib/scheduled";
import { cn } from "@/lib/utils";
import type { PlanSite } from "../calendar/plan-dialog";
import { PlaceArticlesButton } from "../categories/place-dialog";
import { SuggestCategoriesButton } from "../categories/suggest-dialog";
import { BriefCard } from "./brief-card";
import { CoverageSection } from "./coverage-section";
import { NextSteps } from "./next-steps";
import { TodoSection } from "./todo-section";
import { WeeksSection } from "./weeks-section";

/** "Published lately" on the overview counts this many days back. */
const RECENT_DAYS = 30;

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t.overview.metaTitle} · ${t.common.appName}` };
}

export default async function OverviewPage({ searchParams }: PageProps<"/admin/overview">) {
  const user = await requireUser();
  const t = await getT();
  const lang = await getLang();
  const timeZone = await getTimeZone();
  await publishDuePosts();
  const seesAll = can(user.role, "posts.editAny");
  const params = await searchParams;
  const db = await getDb();

  // The busiest website first, as on the articles list.
  const postCounts = new Map(
    (await db.select({ siteId: schema.posts.siteId, n: count() }).from(schema.posts).where(isNull(schema.posts.deletedAt)).groupBy(schema.posts.siteId)).map((r) => [r.siteId, r.n]),
  );
  const sites = (await db.select().from(schema.sites)).sort((a, b) => (postCounts.get(b.id) ?? 0) - (postCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const site = sites.find((s) => s.id === params.site) ?? sites[0];
  if (!site) return null;

  const [categories, posts, people] = await Promise.all([
    db.select().from(schema.categories).where(eq(schema.categories.siteId, site.id)).orderBy(asc(schema.categories.position)),
    db.query.posts.findMany({
      where: (p, { and, eq, isNull }) => and(eq(p.siteId, site.id), isNull(p.deletedAt)),
      with: { translations: true },
    }),
    db.select({ id: schema.users.id, jobTitles: schema.users.jobTitles, bios: schema.users.bios }).from(schema.users),
  ]);
  const profiles = new Map(people.map((u) => [u.id, u]));
  const today = getDayKey(new Date(), timeZone);
  const topicNames = new Map(categories.map((c) => [c.id, categoryName(c, lang)]));

  const overviewPosts: OverviewPost[] = posts.map((p) => ({
    id: p.id,
    categoryId: p.categoryId,
    pillar: p.pillar,
    plannedFor: p.plannedFor,
    versions: p.translations.map((tr) => ({ locale: tr.locale, status: tr.status, publishedAt: tr.publishedAt, scheduledAt: tr.scheduledAt })),
  }));
  const coverage = getTopicCoverage(overviewPosts, categories.map((c) => c.id), today, timeZone);
  const weeks = getWeekLoad(overviewPosts, today, timeZone);
  const gaps = getLanguageGaps(overviewPosts);
  const uncategorized = posts.filter((p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId));
  const steps = getNextSteps({
    hasBrief: hasBrief(site.contentBrief),
    postsPerWeek: site.postsPerWeek,
    hasCategories: categories.length > 0,
    uncategorized: uncategorized.length,
    coverage,
    weeks,
    gaps,
  });

  const live = posts.filter((p) => p.translations.some((tr) => tr.status === "published"));
  const liveIn = (l: Locale) => live.filter((p) => p.translations.some((tr) => tr.locale === l && tr.status === "published")).length;
  const recent = live.filter((p) =>
    p.translations.some((tr) => tr.status === "published" && tr.publishedAt && daysBetween(getDayKey(tr.publishedAt, timeZone), today) <= RECENT_DAYS),
  ).length;

  // Writers look after their own articles: the lists below are theirs, the counts above the website's.
  const mine = seesAll ? posts : posts.filter((p) => p.authorId === user.id);
  const todoVersions: TodoVersion[] = mine.flatMap((p) =>
    p.translations.map((tr) => {
      const score = scoreVersion({ ...p, site }, tr, p.authorId ? profiles.get(p.authorId) : undefined);
      return {
        postId: p.id,
        locale: tr.locale,
        title: tr.title,
        status: tr.status,
        updatedAt: tr.updatedAt,
        plannedFor: p.plannedFor,
        score: score.score,
        internalLinks: Number(score.checks.find((c) => c.id === "internalLinks")?.vars.n ?? 0),
        imageSuggestions: countImageSuggestions(tr.contentHtml),
      };
    }),
  );
  const todo = getTodo(todoVersions, today, timeZone);
  const mineIds = new Set(mine.map((p) => p.id));
  const shownGaps = gaps
    .filter((g) => mineIds.has(g.postId))
    .map((g) => ({ ...g, title: posts.find((p) => p.id === g.postId)?.translations.find((tr) => tr.locale === g.has)?.title ?? "" }));

  const canPlan = can(user.role, "posts.create");
  const planSite: PlanSite = {
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    brief: site.contentBrief,
    defaultLocale: site.defaultLocale,
    categories: categories.map((c) => ({ id: c.id, names: c.names })),
    titles: Object.fromEntries(
      LOCALES.map((l) => [l, posts.map((p) => p.translations.find((tr) => tr.locale === l)?.title ?? "").filter((title) => title.trim())]),
    ) as Record<Locale, string[]>,
  };
  const plan = canPlan ? { site: planSite, startDay: addDays(today, 1), aiEnabled: aiConfigured() } : null;
  // The AI category buttons, for those who manage categories.
  const mainOf = (p: (typeof posts)[number]) => p.translations.find((tr) => tr.locale === site.defaultLocale) ?? p.translations[0];
  const briefSite = { id: site.id, name: site.name, baseUrl: site.baseUrl, brief: site.contentBrief };
  const categoryRows = categories.map((c) => ({ id: c.id, nameVi: categoryName(c, "vi"), nameEn: categoryName(c, "en") }));
  const suggestProps = {
    site: briefSite,
    existing: categoryRows.map((c) => ({ ...c, posts: posts.filter((p) => p.categoryId === c.id).length })),
    titles: posts.map((p) => ({ title: mainOf(p)?.title ?? "", category: topicNames.get(p.categoryId ?? "") ?? null })),
    aiEnabled: aiConfigured(),
  };
  const categoryTools = can(user.role, "categories.manage")
    ? {
        suggest: <SuggestCategoriesButton {...suggestProps} variant="inline" />,
        place: (
          <PlaceArticlesButton
            site={briefSite}
            categories={categoryRows}
            articles={uncategorized.map((p) => ({ id: p.id, title: mainOf(p)?.title ?? "", excerpt: mainOf(p)?.excerpt ?? "" }))}
            aiEnabled={aiConfigured()}
            variant="inline"
          />
        ),
        review: <SuggestCategoriesButton {...suggestProps} />,
      }
    : null;
  const postHref = (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post || (!seesAll && post.authorId !== user.id)) return null;
    return `/admin/posts/${post.id}?locale=${post.translations[0]?.locale ?? site.defaultLocale}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t.overview.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t.overview.subtitle}</p>
        </div>
        {sites.length > 1 && (
          <nav className="flex rounded-lg bg-zinc-100 p-0.5" aria-label={t.overview.sitesLabel}>
            {sites.map((s) => (
              <Link
                key={s.id}
                href={`/admin/overview?site=${encodeURIComponent(s.id)}`}
                aria-current={s.id === site.id ? "page" : undefined}
                className={cn("rounded-md px-3 py-1.5 text-sm", s.id === site.id ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800")}
              >
                {s.name}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <div className="mt-6 flex flex-col gap-6">
        <NextSteps
          steps={steps}
          siteId={site.id}
          topicNames={topicNames}
          canEditBrief={can(user.role, "strategy.manage")}
          categoryTools={categoryTools}
          plan={plan}
        />
        <BriefCard
          key={site.id}
          siteId={site.id}
          brief={site.contentBrief}
          postsPerWeek={site.postsPerWeek}
          canEdit={can(user.role, "strategy.manage")}
          startEditing={params.edit === "brief"}
        />
        <CoverageSection
          coverage={coverage}
          topicNames={topicNames}
          stats={{
            live: live.length,
            liveDetail: LOCALES.map((l) => `${l.toUpperCase()} ${liveIn(l)}`).join(" · "),
            last30: recent,
            average: getWeeklyAverage(overviewPosts, today, timeZone),
            target: site.postsPerWeek,
          }}
          monthly={getMonthlyOutput(overviewPosts, today, timeZone)}
          postHref={postHref}
          plan={plan}
          categoryTool={categoryTools?.review ?? null}
        />
        <WeeksSection siteId={site.id} weeks={weeks} target={site.postsPerWeek} gaps={shownGaps} />
        <TodoSection todo={todo} ownOnly={!seesAll} timeZone={timeZone} />
      </div>
    </div>
  );
}
