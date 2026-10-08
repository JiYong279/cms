import { fmt, type Dict } from "@/i18n";
import { isFieldChangeList, type FieldChange, type FieldValue } from "./activity-changes";

/**
 * What an activity-log entry says, in the reader's language. Entries store an action code and
 * the values it needs in `meta`; the stored Vietnamese `summary` is the fallback for entries
 * that predate this (or whose meta is incomplete).
 *
 * Meta each action expects:
 *   post.updated / published / auto_published / scheduled / submitted / translated  { locale }
 *   post.status_changed / post.unpublished   { locale, status }
 *   post.synced                              { locale, source }
 *   post.purged                              { days }
 *   post.planned                             { date: "YYYY-MM-DD" }
 *   post.rescheduled                         { date: "YYYY-MM-DD", time?: "HH:mm" }
 *   post.assigned                            { name }
 *   post.ai_planned                          { topic, n, name }
 *   post.ai_categorized / category.ai_proposed   { n, name }   (name: the website)
 *   post.categorized                         { name, nameEn }   (the category)
 *   post.created                             (uses the entry's website name)
 *   user.created                             { name, role }
 *   user.updated                             { name, changes: [{ type: "role", from, to } | { type: "lock" } | { type: "unlock" } | { type: "rename", to }] }
 *   user.password_reset                      { name }
 *   role.updated                             { role, added: Permission[], removed: Permission[] }
 *   site.created / site.updated / site.brief_updated   { name }
 */
export type ActivityChange =
  | { type: "role"; from: string; to: string }
  | { type: "lock" }
  | { type: "unlock" }
  | { type: "rename"; to: string };

type Entry = { action: string; summary: string; meta: Record<string, unknown> | null; siteName?: string | null };

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

export function describeActivity(entry: Entry, t: Dict): string {
  const template = (t.activity.actions as Record<string, string>)[entry.action];
  if (!template) return entry.summary;
  const meta = entry.meta ?? {};
  const roles = t.common.roles as Record<string, string>;
  const statuses = t.common.status as Record<string, string>;

  const vars: Record<string, string> = {};
  const locale = str(meta.locale);
  if (locale) vars.locale = locale.toUpperCase();
  const source = str(meta.source);
  if (source) vars.source = source.toUpperCase();
  const status = str(meta.status);
  if (status) vars.status = statuses[status] ?? status;
  // A calendar day, not an instant: formatted in UTC so it never shifts to the day before or after.
  const date = str(meta.date);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    vars.date = new Intl.DateTimeFormat(t.common.dateLocale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
    // A time of day (HH:mm, as recorded) goes with the day when the entry has one.
    const time = str(meta.time);
    if (time && /^\d{2}:\d{2}$/.test(time)) vars.date = fmt(t.activity.dateAtTime, { date: vars.date, time });
  }
  const n = str(meta.n);
  if (n) vars.n = n;
  const topic = str(meta.topic);
  if (topic) vars.topic = topic;
  const days = str(meta.days);
  if (days) vars.days = days;
  const name = str(meta.name);
  if (name) vars.name = name;
  // Categories have a name per language; English lines use the English one.
  const nameEn = str(meta.nameEn) ?? name;
  if (nameEn) vars.nameEn = nameEn;
  const role = str(meta.role);
  if (role) vars.role = roles[role] ?? role;
  if (entry.siteName) vars.site = entry.siteName;
  if (Array.isArray(meta.changes)) {
    vars.changes = (meta.changes as ActivityChange[])
      .map((c) =>
        c.type === "role"
          ? fmt(t.activity.changes.role, { from: roles[c.from] ?? c.from, to: roles[c.to] ?? c.to })
          : c.type === "rename"
            ? fmt(t.activity.changes.rename, { to: c.to })
            : t.activity.changes[c.type],
      )
      .join(", ");
  }
  if (Array.isArray(meta.added) || Array.isArray(meta.removed)) {
    const permissions = t.common.permissions as Record<string, string>;
    const list = (value: unknown, template: string) =>
      (Array.isArray(value) ? value : []).map((p) => fmt(template, { permission: permissions[String(p)] ?? String(p) }));
    vars.grants = [...list(meta.added, t.activity.changes.granted), ...list(meta.removed, t.activity.changes.revoked)].join(", ");
  }

  // Missing a value the template needs: keep the text recorded at the time.
  const needed = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (needed.some((k) => !(k in vars))) return entry.summary;
  return fmt(template, vars);
}

const DATE_FIELDS = new Set(["scheduledAt", "publishedAt"]);

/**
 * The lines shown under an entry: what a save changed (meta.fields), one line per field, and
 * what older entries recorded (a renamed address, the IP address of a sign-in).
 */
export function describeActivityDetails(entry: Pick<Entry, "meta">, t: Dict, timeZone: string): string[] {
  const meta = entry.meta ?? {};
  const d = t.activity.details;
  const labels = t.activity.fields as Record<string, string>;
  const number = new Intl.NumberFormat(t.common.dateLocale);
  const dateTime = new Intl.DateTimeFormat(t.common.dateLocale, { dateStyle: "medium", timeStyle: "short", timeZone });

  const fields: FieldChange[] = isFieldChangeList(meta.fields) ? meta.fields : [];
  // Before field changes were recorded, a save kept only a renamed address.
  if (!fields.length && typeof meta.slugFrom === "string" && typeof meta.slugTo === "string") {
    fields.push({ field: "slug", from: meta.slugFrom, to: meta.slugTo });
  }

  const lines = fields.map((c) => {
    const field = labels[c.field] ?? c.field;
    if (c.field === "content") {
      const to = Number(c.to);
      if (c.from === null) return fmt(d.wordsNew, { to: number.format(to) });
      const diff = to - Number(c.from);
      if (diff === 0) return fmt(d.wordsSame, { to: number.format(to) });
      return fmt(d.words, { from: number.format(Number(c.from)), to: number.format(to), diff: `${diff > 0 ? "+" : "−"}${number.format(Math.abs(diff))}` });
    }
    if (c.field === "coverImageUrl") return c.from === null ? d.imageAdded : c.to === null ? d.imageRemoved : d.imageChanged;
    if (typeof c.to === "boolean" || typeof c.from === "boolean") return fmt(c.to ? d.on : d.off, { field });
    const show = (v: FieldValue) =>
      DATE_FIELDS.has(c.field) && typeof v === "string"
        ? dateTime.format(new Date(v))
        : c.field === "defaultLocale"
          ? String(v).toUpperCase()
          : fmt(d.quote, { value: String(v) });
    if (c.from === null) return fmt(d.added, { field, to: show(c.to) });
    if (c.to === null) return fmt(d.removed, { field, from: show(c.from) });
    return fmt(d.changed, { field, from: show(c.from), to: show(c.to) });
  });
  if (typeof meta.ip === "string" && meta.ip) lines.push(fmt(d.ip, { ip: meta.ip }));
  return lines;
}
