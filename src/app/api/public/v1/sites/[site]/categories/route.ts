import { schema } from "@/db";
import type { Locale } from "@/db/schema";
import { listPublicCategories, siteExists } from "@/lib/public-posts";

/** A website's categories in one language, with how many published articles each has. */
export async function GET(request: Request, ctx: RouteContext<"/api/public/v1/sites/[site]/categories">) {
  const { site } = await ctx.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? "vi";
  if (!(schema.localeEnum.enumValues as readonly string[]).includes(locale)) {
    return Response.json({ error: "Unknown locale" }, { status: 400 });
  }
  if (!(await siteExists(site))) return Response.json({ error: "Unknown site" }, { status: 404 });

  const categories = await listPublicCategories(site, locale as Locale);
  return Response.json(
    { categories },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
