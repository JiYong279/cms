// The content overview: topic coverage, output, the weeks ahead, language gaps, the to-do list, next steps.
//   npx tsx tests/seo/overview.test.ts
import {
  MIN_CLUSTER_ARTICLES,
  getLanguageGaps,
  getMonthlyOutput,
  getNextSteps,
  getTodo,
  getTopicCoverage,
  getWeekLoad,
  getWeeklyAverage,
  type OverviewPost,
  type TodoVersion,
} from "../../src/lib/content-overview";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};

const TZ = "Asia/Ho_Chi_Minh";
// 2026-09-29 is a Tuesday.
const TODAY = "2026-09-29";
const at = (day: string) => new Date(`${day}T03:00:00Z`);
let n = 0;
const post = (change: Partial<OverviewPost>): OverviewPost => ({ id: `p${++n}`, categoryId: "emr", pillar: false, plannedFor: null, versions: [], ...change });
const live = (day: string, locales: ("vi" | "en")[] = ["vi"]) => locales.map((locale) => ({ locale, status: "published" as const, publishedAt: at(day), scheduledAt: null }));
const draft = [{ locale: "vi" as const, status: "draft" as const, publishedAt: null, scheduledAt: null }];

const posts: OverviewPost[] = [
  post({ pillar: true, versions: live("2026-09-01", ["vi", "en"]) }),
  ...Array.from({ length: 3 }, () => post({ versions: live("2026-09-10") })),
  post({ versions: draft, plannedFor: "2026-10-01" }),
  post({ categoryId: "ops", versions: live("2026-05-01") }),
  post({ categoryId: "ops", pillar: true, versions: draft }),
  post({ categoryId: null, versions: live("2026-08-15") }),
  post({ categoryId: "ops", versions: [{ locale: "vi", status: "scheduled", publishedAt: null, scheduledAt: at("2026-10-07") }] }),
];

const coverage = getTopicCoverage(posts, ["emr", "ops", "empty"], TODAY, TZ);
const emr = coverage.find((c) => c.categoryId === "emr");
const ops = coverage.find((c) => c.categoryId === "ops");
const empty = coverage.find((c) => c.categoryId === "empty");
const none = coverage.find((c) => c.categoryId === null);
check("a topic counts its live articles, apart from its overview", emr?.live === 4 && emr.liveCluster === 3 && emr.inProgress === 1, JSON.stringify(emr));
check("a topic with its overview live only lacks articles", emr?.pillar?.live === true && emr.needs.join() === "thin", JSON.stringify(emr?.needs));
check(`a topic is thin below ${MIN_CLUSTER_ARTICLES} other articles`, !!ops?.needs.includes("thin"));
check("an overview being written shows, but the topic still lacks a live one", ops?.pillar?.live === false && ops.needs.includes("pillar"));
check("a topic with nothing new for months has gone quiet", !!ops?.needs.includes("quiet") && ops.lastPublished === "2026-05-01");
check("an empty category needs everything but is not quiet", empty?.needs.join() === "pillar,thin", JSON.stringify(empty));
check("articles without a category come last and need nothing", coverage.at(-1) === none && none?.live === 1 && none.needs.length === 0);

const output = getMonthlyOutput(posts, TODAY, TZ);
check("output covers six months up to this one", output.length === 6 && output[0].month === "2026-04" && output[5].month === "2026-09");
check("each article counts once, in the month it first came out", output[5].count === 4 && output[4].count === 1 && output[1].count === 1, JSON.stringify(output));
check("the average is over the last eight full weeks", getWeeklyAverage(posts, TODAY, TZ) === 0.6, String(getWeeklyAverage(posts, TODAY, TZ)));

const weeks = getWeekLoad(posts, TODAY, TZ);
check("the weeks ahead start on this week's Monday", weeks[0].start === "2026-09-28" && weeks[0].end === "2026-10-04" && weeks.length === 4);
check("planned and scheduled articles count in their week", weeks[0].count === 1 && weeks[1].count === 1 && weeks[2].count === 0, JSON.stringify(weeks));

const gaps = getLanguageGaps(posts);
check("live articles in one language only are gaps", gaps.length === 5 && gaps.every((g) => g.has === "vi" && g.missing === "en"), JSON.stringify(gaps));

const version = (change: Partial<TodoVersion>): TodoVersion => ({
  postId: `v${++n}`, locale: "vi", title: "", status: "published", updatedAt: at("2026-09-20"), plannedFor: null, score: 90, internalLinks: 2, imageSuggestions: 0, ...change,
});
const todo = getTodo(
  [
    version({ title: "weak", score: 30 }),
    version({ title: "weaker", score: 10, internalLinks: 0 }),
    version({ title: "old", updatedAt: at("2025-06-01") }),
    version({ title: "pictures", imageSuggestions: 2 }),
    version({ title: "late", status: "draft", plannedFor: "2026-09-20", postId: "late" }),
    version({ title: "late en", status: "draft", plannedFor: "2026-09-20", postId: "late", locale: "en" }),
    version({ title: "forgotten", status: "draft", updatedAt: at("2026-07-01") }),
    version({ title: "fresh draft", status: "draft", updatedAt: at("2026-09-25") }),
    version({ title: "weak draft", status: "draft", score: 5, updatedAt: at("2026-09-25") }),
  ],
  TODAY,
  TZ,
);
const titles = (k: keyof typeof todo) => todo[k].map((v) => v.title).join();
check("low scores are live versions only, the weakest first", titles("lowScore") === "weaker,weak", titles("lowScore"));
check("live versions without internal links are listed", titles("noLinks") === "weaker");
check("live versions still waiting for pictures are listed", titles("missingImages") === "pictures");
check("a year without changes is out of date", titles("outdated") === "old");
check("a planned day that passed shows once per article", titles("overdue") === "late", titles("overdue"));
check("a draft untouched for a month with no day planned is forgotten", titles("abandoned") === "forgotten", titles("abandoned"));

const steps = getNextSteps({ hasBrief: false, postsPerWeek: 2, hasCategories: true, coverage, weeks, gaps });
const kinds = steps.map((s) => s.kind).join();
check("the brief comes first", steps[0].kind === "brief");
check("a topic whose overview is being written is not asked for one again", !steps.some((s) => s.kind === "pillar" && s.categoryId === "ops") && steps.some((s) => s.kind === "pillar" && s.categoryId === "empty"));
check("the thinnest topics come first", steps.filter((s) => s.kind === "thin").map((s) => (s.kind === "thin" ? s.categoryId : "")).join() === "empty,ops,emr", kinds);
check("weeks below the target are listed", steps.filter((s) => s.kind === "week").length === 4, kinds);
check("missing translations and quiet topics come last", kinds.endsWith("translate,quiet"), kinds);
check("without a target the weeks are not judged, and the target is asked for", (() => {
  const k = getNextSteps({ hasBrief: true, postsPerWeek: null, hasCategories: true, coverage, weeks, gaps }).map((s) => s.kind);
  return k[0] === "target" && !k.includes("week");
})());

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
