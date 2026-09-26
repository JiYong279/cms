import { publishDuePosts } from "@/lib/scheduled";

/**
 * Publishes scheduled articles whose time has come. Point a scheduler at it every few minutes
 * with `Authorization: Bearer <CRON_SECRET>` (on the server, the cms-cron container does this).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const published = await publishDuePosts({ force: true });
  return Response.json({ ok: true, published: published.length });
}
