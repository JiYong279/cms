import { getDb } from "@/db";
import type { Locale } from "@/db/schema";
import { MAX_LINK_TARGETS, type LinkTarget } from "./ai-seo";

/**
 * The website's live articles in `locale` a draft may link to, by their public address: pillar
 * articles first (the draft's own topic's first of all), then its topic's other articles, then the
 * newest. The article being written is left out.
 */
export async function getLinkTargets(input: { siteId: string; locale: Locale; excludePostId: string; categoryId: string | null }): Promise<LinkTarget[]> {
  const db = await getDb();
  const [site, posts] = await Promise.all([
    db.query.sites.findFirst({ where: (s, { eq }) => eq(s.id, input.siteId) }),
    db.query.posts.findMany({
      where: (p, { and, eq, isNull, ne }) => and(eq(p.siteId, input.siteId), isNull(p.deletedAt), ne(p.id, input.excludePostId)),
      with: { translations: true },
    }),
  ]);
  if (!site) return [];
  const live = posts
    .map((p) => ({ post: p, tr: p.translations.find((tr) => tr.locale === input.locale && tr.status === "published" && !tr.noindex) }))
    .filter((x): x is { post: (typeof posts)[number]; tr: NonNullable<typeof x.tr> } => !!x.tr && !!x.tr.title.trim());
  const rank = (x: (typeof live)[number]) => {
    const sameTopic = !!input.categoryId && x.post.categoryId === input.categoryId;
    return (x.post.pillar && sameTopic ? 0 : x.post.pillar ? 1 : sameTopic ? 2 : 3) * 1e13 - (x.tr.publishedAt?.getTime() ?? 0);
  };
  const base = site.baseUrl.replace(/\/$/, "");
  return live
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_LINK_TARGETS)
    // Only the draft's own topic's pillar is marked: that is the one it must link back to.
    .map((x) => ({
      title: x.tr.title,
      url: `${base}${site.blogPaths[input.locale]}/${x.tr.slug}`,
      pillar: x.post.pillar && !!input.categoryId && x.post.categoryId === input.categoryId,
    }));
}
