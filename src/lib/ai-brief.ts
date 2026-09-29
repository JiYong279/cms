/**
 * What a writer needs to know about each website: used by the CMS's own AI assistant and by the
 * prompts people copy into their own Claude. No server-only code here, so the editor can use it.
 * The team's own brief (sites.content_brief) wins; these stand in until it is written.
 */
const SITE_BRIEFS: Record<string, string> = {
  qubx: `Qub-X (qub-x.com) is software for aesthetic clinics and spa chains in Vietnam: scheduling,
payments, customer and treatment records, an omni-channel inbox (Zalo, Facebook, phone), inventory
and analytics. Readers are clinic owners and managers. Write practical, specific advice for them;
mention Qub-X at most once, near the end, and never as a hard sell.`,
};

/** The parts of a website's content brief. */
export const BRIEF_FIELDS = ["audience", "goal", "offering", "voice", "avoid", "notes"] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
export type ContentBrief = Partial<Record<BriefField, string>>;
export const MAX_BRIEF_FIELD_CHARS = 1000;
export const MAX_POSTS_PER_WEEK = 21;

export type BriefSite = { id: string; name: string; baseUrl: string; brief: ContentBrief };

/** How each part of the brief is introduced to the AI (the team writes the parts in any language). */
const BRIEF_LABELS: Record<BriefField, string> = {
  audience: "Readers",
  goal: "What the blog is for",
  offering: "What articles lead readers to",
  voice: "Voice",
  avoid: "Never write about or do",
  notes: "Other notes",
};

/** True once the team has written at least one part of the brief. */
export function hasBrief(brief: ContentBrief) {
  return BRIEF_FIELDS.some((f) => brief[f]?.trim());
}

export function siteBrief(site: BriefSite) {
  if (hasBrief(site.brief)) {
    return BRIEF_FIELDS.filter((f) => site.brief[f]?.trim())
      .map((f) => `${BRIEF_LABELS[f]}: ${site.brief[f]?.trim()}`)
      .join("\n");
  }
  return SITE_BRIEFS[site.id] ?? `The article is published on the blog of ${site.name} (${site.baseUrl}).`;
}
