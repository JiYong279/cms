import { schema } from "@/db";
import type { Locale } from "@/db/schema";
import { listPublicPosts, siteExists } from "@/lib/public-posts";

/** Published articles of one website in one language, newest first. */
export async function GET(request: Request, ctx: RouteContext<"/api/public/v1/sites/[site]/posts">) {
  const { site } = await ctx.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? "vi";
  if (!(schema.localeEnum.enumValues as readonly string[]).includes(locale)) {
    return Response.json({ error: "Unknown locale" }, { status: 400 });
  }
  if (!(await siteExists(site))) return Response.json({ error: "Unknown site" }, { status: 404 });

  const posts = await listPublicPosts(site, locale as Locale);
  return Response.json(
    { posts },
    // Websites also refresh on publish (see lib/revalidate), so a short shared cache is enough.
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
