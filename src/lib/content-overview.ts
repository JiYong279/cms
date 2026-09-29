import type { Locale, PostStatus } from "@/db/schema";
import { addDays, daysBetween, getDayKey, getWeekStart } from "./days";
import { LOCALES } from "./posts";
import { SCORE_THRESHOLDS } from "./seo-score";

/**
 * The content overview: what someone taking over the blog asks first. Is there enough on each
 * topic, is the team keeping up, what to write next and which articles need work. Everything here
 * is worked out from the articles themselves; the page only lays it out.
 */

/** A topic (category) is covered once it has its overview article and this many others. */
export const MIN_CLUSTER_ARTICLES = 8;
/** A topic with nothing new for this long has gone quiet. */
export const QUIET_TOPIC_DAYS = 60;
/** A live article not touched for this long may be out of date. */
export const OUTDATED_DAYS = 365;
/** A draft not touched for this long, with no day planned ahead, is probably forgotten. */
export const ABANDONED_DRAFT_DAYS = 30;
/** How far ahead the plan is checked, in weeks from this one. */
export const PLAN_AHEAD_WEEKS = 4;
/** How many months of output are shown, this one included. */
export const OUTPUT_MONTHS = 6;
/** The weeks the average output is taken over. */
export const AVERAGE_WEEKS = 8;

export type OverviewVersion = {
  locale: Locale;
  status: PostStatus;
  publishedAt: Date | null;
  scheduledAt: Date | null;
};

export type OverviewPost = {
  id: string;
  categoryId: string | null;
  pillar: boolean;
  /** YYYY-MM-DD, the day the team means to publish it. */
  plannedFor: string | null;
  versions: OverviewVersion[];
};

export const isLiveArticle = (post: OverviewPost) => post.versions.some((v) => v.status === "published");

/** The day readers first saw the article, in the viewer's time zone (null when never published). */
function firstPublishedDay(post: OverviewPost, timeZone: string) {
  const days = post.versions.filter((v) => v.status === "published" && v.publishedAt).map((v) => getDayKey(v.publishedAt as Date, timeZone));
  return days.length ? days.sort()[0] : null;
}

/** The day an article counts for: when it came out, when it is scheduled, or when it is planned. */
function targetDay(post: OverviewPost, timeZone: string) {
  const published = firstPublishedDay(post, timeZone);
  if (published) return published;
  const scheduled = post.versions.filter((v) => v.status === "scheduled" && v.scheduledAt).map((v) => getDayKey(v.scheduledAt as Date, timeZone));
  return scheduled.length ? scheduled.sort()[0] : post.plannedFor;
}

export type TopicNeed = "pillar" | "thin" | "quiet";

export type TopicCoverage = {
  /** null: the articles without a category. */
  categoryId: string | null;
  live: number;
  /** Live articles other than the overview. */
  liveCluster: number;
  /** Articles not live yet: drafts, in review, scheduled. */
  inProgress: number;
  /** The live overview article, or else one being written. */
  pillar: { postId: string; live: boolean } | null;
  lastPublished: string | null;
  needs: TopicNeed[];
};

/** How well each topic is covered, in the categories' order; articles without a category come last. */
export function getTopicCoverage(posts: OverviewPost[], categoryIds: string[], today: string, timeZone: string): TopicCoverage[] {
  const topics: (string | null)[] = [...categoryIds];
  if (posts.some((p) => !p.categoryId || !categoryIds.includes(p.categoryId))) topics.push(null);
  return topics.map((categoryId) => {
    const own = posts.filter((p) => (categoryId ? p.categoryId === categoryId : !p.categoryId || !categoryIds.includes(p.categoryId)));
    const live = own.filter(isLiveArticle);
    const livePillar = live.find((p) => p.pillar);
    const draftPillar = own.find((p) => p.pillar && !isLiveArticle(p));
    const lastPublished = live.map((p) => firstPublishedDay(p, timeZone)).filter((d): d is string => !!d).sort().at(-1) ?? null;
    const liveCluster = live.filter((p) => p !== livePillar).length;
    const needs: TopicNeed[] = [];
    // Articles without a category have no topic to cover: only a category can be thin or lack its overview.
    if (categoryId) {
      if (!livePillar) needs.push("pillar");
      if (liveCluster < MIN_CLUSTER_ARTICLES) needs.push("thin");
      if (live.length > 0 && lastPublished && daysBetween(lastPublished, today) > QUIET_TOPIC_DAYS) needs.push("quiet");
    }
    return {
      categoryId,
      live: live.length,
      liveCluster,
      inProgress: own.length - live.length,
      pillar: livePillar ? { postId: livePillar.id, live: true } : draftPillar ? { postId: draftPillar.id, live: false } : null,
      lastPublished,
      needs,
    };
  });
}

/** Articles first published each month, the last OUTPUT_MONTHS months up to `today`'s, oldest first. */
export function getMonthlyOutput(posts: OverviewPost[], today: string, timeZone: string) {
  const [year, month] = today.split("-").map(Number);
  const months = Array.from({ length: OUTPUT_MONTHS }, (_, i) => new Date(Date.UTC(year, month - 1 - (OUTPUT_MONTHS - 1 - i), 1)).toISOString().slice(0, 7));
  const days = posts.map((p) => firstPublishedDay(p, timeZone)).filter((d): d is string => !!d);
  return months.map((m) => ({ month: m, count: days.filter((d) => d.startsWith(m)).length }));
}

/** Articles first published per week on average over the last AVERAGE_WEEKS full weeks. */
export function getWeeklyAverage(posts: OverviewPost[], today: string, timeZone: string) {
  const end = getWeekStart(today);
  const start = addDays(end, -7 * AVERAGE_WEEKS);
  const n = posts.map((p) => firstPublishedDay(p, timeZone)).filter((d) => d && d >= start && d < end).length;
  return Math.round((n / AVERAGE_WEEKS) * 10) / 10;
}

export type WeekLoad = { start: string; end: string; count: number };

/** Articles out, scheduled or planned in this week and the next ones, PLAN_AHEAD_WEEKS in all. */
export function getWeekLoad(posts: OverviewPost[], today: string, timeZone: string): WeekLoad[] {
  const first = getWeekStart(today);
  const days = posts.map((p) => targetDay(p, timeZone)).filter((d): d is string => !!d);
  return Array.from({ length: PLAN_AHEAD_WEEKS }, (_, w) => {
    const start = addDays(first, 7 * w);
    const end = addDays(start, 6);
    return { start, end, count: days.filter((d) => d >= start && d <= end).length };
  });
}

export type LanguageGap = { postId: string; has: Locale; missing: Locale };

/** Live articles readers can only find in one language. */
export function getLanguageGaps(posts: OverviewPost[]): LanguageGap[] {
  const gaps: LanguageGap[] = [];
  for (const post of posts.filter(isLiveArticle)) {
    const live = post.versions.filter((v) => v.status === "published").map((v) => v.locale);
    const missing = LOCALES.find((l) => !live.includes(l));
    if (missing) gaps.push({ postId: post.id, has: live[0], missing });
  }
  return gaps;
}

export type TodoVersion = {
  postId: string;
  locale: Locale;
  title: string;
  status: PostStatus;
  updatedAt: Date;
  plannedFor: string | null;
  score: number;
  internalLinks: number;
  imageSuggestions: number;
};

export type TodoKind = "overdue" | "lowScore" | "noLinks" | "missingImages" | "outdated" | "abandoned";
export const TODO_KINDS: TodoKind[] = ["overdue", "lowScore", "noLinks", "missingImages", "outdated", "abandoned"];

/** Articles that need someone's attention, per reason, the most pressing first in each. */
export function getTodo(versions: TodoVersion[], today: string, timeZone: string): Record<TodoKind, TodoVersion[]> {
  const age = (v: TodoVersion) => daysBetween(getDayKey(v.updatedAt, timeZone), today);
  const live = versions.filter((v) => v.status === "published");
  const waiting = versions.filter((v) => v.status === "draft" || v.status === "in_review");
  // One line per article for what is planned per article, not per language.
  const onePerPost = (list: TodoVersion[]) => list.filter((v, i) => list.findIndex((x) => x.postId === v.postId) === i);
  return {
    overdue: onePerPost(waiting.filter((v) => v.plannedFor && v.plannedFor < today)).sort((a, b) => (a.plannedFor ?? "").localeCompare(b.plannedFor ?? "")),
    lowScore: live.filter((v) => v.score < SCORE_THRESHOLDS.ok).sort((a, b) => a.score - b.score),
    noLinks: live.filter((v) => v.internalLinks === 0),
    missingImages: live.filter((v) => v.imageSuggestions > 0),
    outdated: live.filter((v) => age(v) > OUTDATED_DAYS).sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()),
    abandoned: onePerPost(waiting.filter((v) => v.status === "draft" && !v.plannedFor && age(v) > ABANDONED_DRAFT_DAYS)).sort(
      (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
    ),
  };
}

export type NextStep =
  | { kind: "brief" }
  | { kind: "target" }
  | { kind: "categories" }
  | { kind: "pillar"; categoryId: string }
  | { kind: "thin"; categoryId: string; have: number }
  | { kind: "week"; start: string; have: number; target: number }
  | { kind: "translate"; n: number; missing: Locale }
  | { kind: "quiet"; categoryId: string; since: string };

/** What to do next, most useful first: set the direction, then fill the gaps in topics and weeks. */
export function getNextSteps(input: {
  hasBrief: boolean;
  postsPerWeek: number | null;
  hasCategories: boolean;
  coverage: TopicCoverage[];
  weeks: WeekLoad[];
  gaps: LanguageGap[];
}): NextStep[] {
  const steps: NextStep[] = [];
  if (!input.hasBrief) steps.push({ kind: "brief" });
  if (input.postsPerWeek === null) steps.push({ kind: "target" });
  if (!input.hasCategories) steps.push({ kind: "categories" });
  const topics = input.coverage.filter((c): c is TopicCoverage & { categoryId: string } => c.categoryId !== null);
  // An overview being written already answers "no overview yet".
  for (const c of topics) if (c.needs.includes("pillar") && !c.pillar) steps.push({ kind: "pillar", categoryId: c.categoryId });
  for (const c of [...topics].sort((a, b) => a.liveCluster - b.liveCluster)) {
    if (c.needs.includes("thin")) steps.push({ kind: "thin", categoryId: c.categoryId, have: c.liveCluster });
  }
  const target = input.postsPerWeek;
  if (target) for (const w of input.weeks) if (w.count < target) steps.push({ kind: "week", start: w.start, have: w.count, target });
  for (const missing of LOCALES) {
    const n = input.gaps.filter((g) => g.missing === missing).length;
    if (n) steps.push({ kind: "translate", n, missing });
  }
  for (const c of topics) if (c.needs.includes("quiet") && c.lastPublished) steps.push({ kind: "quiet", categoryId: c.categoryId, since: c.lastPublished });
  return steps;
}
