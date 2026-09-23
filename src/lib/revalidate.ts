import { eq } from "drizzle-orm";
import { after } from "next/server";
import { getDb, schema } from "@/db";

type Slugs = { vi?: string[]; en?: string[] };
export type PingResult = { ok: true; status: number } | { ok: false; status?: number; error: string };

/**
 * Sends the "articles changed" signal to a website.
 *
 * The website receives: POST <revalidateUrl>
 *   header  x-cms-secret: <CMS_REVALIDATE_SECRET>
 *   body    { "site": "qubx", "slugs": { "vi": ["..."], "en": ["..."] } }
 */
export async function pingSite(revalidateUrl: string, siteId: string, slugs: Slugs = {}): Promise<PingResult> {
  try {
    const res = await fetch(revalidateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cms-secret": process.env.CMS_REVALIDATE_SECRET ?? "" },
      body: JSON.stringify({ site: siteId, slugs }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Tells a website that its published articles changed, so it drops its cached copies.
 * Runs after the response is sent; a website that is down never blocks saving in the CMS.
 */
export function notifySite(siteId: string, slugs: Slugs = {}) {
  after(async () => {
    const db = await getDb();
    const [site] = await db
      .select({ revalidateUrl: schema.sites.revalidateUrl })
      .from(schema.sites)
      .where(eq(schema.sites.id, siteId))
      .limit(1);
    if (!site?.revalidateUrl) return;

    const result = await pingSite(site.revalidateUrl, siteId, slugs);
    if (!result.ok) console.warn(`[revalidate] ${siteId}: ${result.error}`);
  });
}
