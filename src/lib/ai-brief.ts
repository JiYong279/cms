/**
 * What a writer needs to know about each website: used by the CMS's own AI assistant and by the
 * prompts people copy into their own Claude. No server-only code here, so the editor can use it.
 */
const SITE_BRIEFS: Record<string, string> = {
  qubx: `Qub-X (qub-x.com) is software for aesthetic clinics and spa chains in Vietnam: scheduling,
payments, customer and treatment records, an omni-channel inbox (Zalo, Facebook, phone), inventory
and analytics. Readers are clinic owners and managers. Write practical, specific advice for them;
mention Qub-X at most once, near the end, and never as a hard sell.`,
};

export function siteBrief(siteId: string, site: { name: string; baseUrl: string }) {
  return SITE_BRIEFS[siteId] ?? `The article is published on the blog of ${site.name} (${site.baseUrl}).`;
}
