import { schema } from "@/db";
import type { Locale } from "@/db/schema";
import { findMovedSlug, getPublicPost } from "@/lib/public-posts";

/** One published article with its content, table of contents and alternate-language slugs. */
export async function GET(request: Request, ctx: RouteContext<"/api/public/v1/sites/[site]/posts/[slug]">) {
  const { site, slug } = await ctx.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? "vi";
  if (!(schema.localeEnum.enumValues as readonly string[]).includes(locale)) {
    return Response.json({ error: "Unknown locale" }, { status: 400 });
  }

  const post = await getPublicPost(site, locale as Locale, slug);
  if (!post) {
    // A renamed article: tell the website where it lives now so it can redirect readers.
    const movedTo = await findMovedSlug(site, locale as Locale, slug);
    if (movedTo) return Response.json({ movedTo }, { status: 301 });
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(
    { post },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
