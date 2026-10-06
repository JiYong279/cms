import Link from "next/link";
import { count, eq, isNull } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDb, schema } from "@/db";
import type { Locale, PostStatus } from "@/db/schema";
import { PostsLayoutSwitch } from "@/components/posts-layout-switch";
import { getT, getTimeZone } from "@/i18n/server";
import { aiConfigured } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { addDays, getDayKey } from "@/lib/days";
import { can, canEditPost, isLive } from "@/lib/permissions";
import { publishDuePosts } from "@/lib/scheduled";
import { cn } from "@/lib/utils";
import { NewPostButton } from "../new-post-button";
import { EditorialCalendar, type CalendarEntry } from "./editorial-calendar";
import { PlanWithAiButton, type PlanSite } from "./plan-dialog";
import { MONTH_PATTERN, getMonthGrid, getMonthLabel, getWeekdayLabels, shiftMonth } from "./month-grid";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t.posts.calendar.metaTitle} · ${t.common.appName}` };
}

/** Keeps the other filters when one of them changes. */
function hrefWith(current: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...change })) if (v) params.set(k, v);
  const query = params.toString();
  return query ? `/admin/calendar?${query}` : "/admin/calendar";
}

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  const user = await requireUser();
  const t = await getT();
  const timeZone = await getTimeZone();
  await publishDuePosts();
  const seesAll = can(user.role, "posts.editAny");
  const params = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const db = await getDb();

  const postCounts = new Map(
    (
      await db
        .select({ siteId: schema.posts.siteId, n: count() })
        .from(schema.posts)
        .where(isNull(schema.posts.deletedAt))
        .groupBy(schema.posts.siteId)
    ).map((r) => [r.siteId, r.n]),
  );
  const sites = (await db.select().from(schema.sites)).sort(
    (a, b) => (postCounts.get(b.id) ?? 0) - (postCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
  );
  const site = sites.find((s) => s.id === pick(params.site))?.id;
  const today = getDayKey(new Date(), timeZone);
  const monthParam = pick(params.month);
  const month = monthParam && MONTH_PATTERN.test(monthParam) ? monthParam : today.slice(0, 7);
  // Writers only ever see their own articles, so "mine" is for editors and admins.
  const mine = seesAll && pick(params.who) === "me";
  const filters = { site, month: monthParam && month !== today.slice(0, 7) ? month : undefined, who: mine ? "me" : undefined };

  const weeks = getMonthGrid(month);
  const firstDay = weeks[0][0];
  const lastDay = weeks[weeks.length - 1][6];

  const posts = await db.query.posts.findMany({
    where: (p, { and, eq, isNull }) =>
      and(
        isNull(p.deletedAt),
        site ? eq(p.siteId, site) : undefined,
        seesAll ? undefined : eq(p.authorId, user.id),
        mine ? eq(p.assigneeId, user.id) : undefined,
      ),
    with: { translations: true, site: true, assignee: { columns: { name: true } } },
  });

  const time = new Intl.DateTimeFormat(t.common.dateLocale, { hour: "2-digit", minute: "2-digit", timeZone });
  const canReschedule = can(user.role, "posts.publish");
  const entries: CalendarEntry[] = [];
  for (const post of posts) {
    const canEdit = canEditPost(user, post);
    const main = post.translations.find((tr) => tr.locale === post.site.defaultLocale) ?? post.translations[0];
    const base = {
      postId: post.id,
      site: post.site.name,
      assignee: post.assignee?.name ?? null,
    };
    // Live versions sit on the day readers see them; the same article, status and day make one card.
    const live = new Map<string, CalendarEntry>();
    for (const tr of post.translations.filter((x) => isLive(x.status))) {
      const at = tr.status === "published" ? tr.publishedAt : tr.scheduledAt;
      if (!at) continue;
      const day = getDayKey(at, timeZone);
      const key = `${post.id}:${tr.status}:${day}`;
      const existing = live.get(key);
      if (existing) {
        existing.locales.push(tr.locale);
        continue;
      }
      live.set(key, {
        ...base,
        id: key,
        title: tr.title || main?.title || "",
        href: `/admin/posts/${post.id}?locale=${tr.locale}`,
        day,
        time: time.format(at),
        status: tr.status,
        locales: [tr.locale],
        planned: false,
        // Published versions keep their day here; scheduled ones move with the right to publish.
        lock: tr.status === "published" ? "published" : canEdit && canReschedule ? null : "notAllowed",
      });
    }
    entries.push(...live.values());

    // Versions not live yet share the article's planned day, and move together.
    const waiting = post.translations.filter((x) => !isLive(x.status));
    if (waiting.length) {
      const first = waiting.find((tr) => tr.locale === main?.locale) ?? waiting[0];
      const status: PostStatus = waiting.some((tr) => tr.status === "in_review") ? "in_review" : first.status;
      entries.push({
        ...base,
        id: `${post.id}:planned`,
        title: first.title || main?.title || "",
        href: `/admin/posts/${post.id}?locale=${first.locale}`,
        day: post.plannedFor,
        time: null,
        status,
        locales: waiting.map((tr) => tr.locale as Locale),
        planned: true,
        lock: canEdit ? null : "notAllowed",
      });
    }
  }
  // "Plan with AI": each website's categories and the titles a plan must not repeat.
  const canPlan = can(user.role, "posts.create");
  const planSites: PlanSite[] = [];
  if (canPlan) {
    const [allCategories, titles] = await Promise.all([
      db.select().from(schema.categories),
      db
        .select({ siteId: schema.postTranslations.siteId, locale: schema.postTranslations.locale, title: schema.postTranslations.title })
        .from(schema.postTranslations)
        .innerJoin(schema.posts, eq(schema.posts.id, schema.postTranslations.postId))
        .where(isNull(schema.posts.deletedAt)),
    ]);
    for (const s of sites) {
      const own = titles.filter((r) => r.siteId === s.id && r.title.trim());
      planSites.push({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        brief: s.contentBrief,
        defaultLocale: s.defaultLocale,
        categories: allCategories
          .filter((c) => c.siteId === s.id)
          .sort((a, b) => a.position - b.position)
          .map((c) => ({ id: c.id, names: c.names })),
        titles: { vi: own.filter((r) => r.locale === "vi").map((r) => r.title), en: own.filter((r) => r.locale === "en").map((r) => r.title) },
      });
    }
  }
  const tomorrow = addDays(today, 1);

  // Only what the grid shows, plus the drafts still waiting for a day.
  const shown = entries.filter((e) => e.day === null || (e.day >= firstDay && e.day <= lastDay));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.posts.calendar.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{seesAll ? t.posts.calendar.subtitle : t.posts.calendar.subtitleOwn}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PostsLayoutSwitch current="calendar" site={site} />
          {canPlan && <PlanWithAiButton sites={planSites} defaultSiteId={site} startDay={tomorrow} aiEnabled={aiConfigured()} />}
          <NewPostButton
            sites={sites.map((s) => ({ id: s.id, name: s.name, baseUrl: s.baseUrl, posts: postCounts.get(s.id) ?? 0 }))}
            defaultSiteId={site}
          />
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-3">
          <div className="flex items-center gap-1">
            <Link
              href={hrefWith(filters, { month: shiftMonth(month, -1) })}
              aria-label={t.posts.calendar.previous}
              title={t.posts.calendar.previous}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <h2 className="min-w-40 text-center text-base font-semibold capitalize text-ink" data-month={month}>
              {getMonthLabel(month, t.common.dateLocale)}
            </h2>
            <Link
              href={hrefWith(filters, { month: shiftMonth(month, 1) })}
              aria-label={t.posts.calendar.next}
              title={t.posts.calendar.next}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            >
              <ChevronRight className="size-4" />
            </Link>
            <Link
              href={hrefWith(filters, { month: undefined })}
              className="ml-1 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
            >
              {t.posts.calendar.today}
            </Link>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {seesAll && (
              <nav className="flex rounded-lg bg-zinc-100 p-0.5" aria-label={t.posts.calendar.whoLabel}>
                {[
                  { id: undefined, label: t.posts.calendar.everyone },
                  { id: "me", label: t.posts.calendar.mine },
                ].map((w) => (
                  <Link
                    key={w.id ?? "all"}
                    href={hrefWith(filters, { who: w.id })}
                    aria-current={(w.id === "me") === mine ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm",
                      (w.id === "me") === mine ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                    )}
                  >
                    {w.label}
                  </Link>
                ))}
              </nav>
            )}
            <nav className="flex rounded-lg bg-zinc-100 p-0.5" aria-label={t.posts.sitesLabel}>
              {[{ id: undefined, name: t.posts.allSites }, ...sites].map((s) => (
                <Link
                  key={s.id ?? "all"}
                  href={hrefWith(filters, { site: s.id })}
                  aria-current={site === s.id ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm",
                    site === s.id ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  {s.name}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <EditorialCalendar
          key={`${month}-${site ?? ""}-${mine}`}
          weeks={weeks}
          month={month}
          today={today}
          weekdays={getWeekdayLabels(weeks[0], t.common.dateLocale)}
          entries={shown}
          showSite={!site && sites.length > 1}
        />
      </section>
    </div>
  );
}
