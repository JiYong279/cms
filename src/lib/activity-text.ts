import { fmt, type Dict } from "@/i18n";

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
 *   post.created                             (uses the entry's website name)
 *   user.created                             { name, role }
 *   user.updated                             { name, changes: [{ type: "role", from, to } | { type: "lock" } | { type: "unlock" } | { type: "rename", to }] }
 *   user.password_reset                      { name }
 *   site.created / site.updated              { name }
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

  // Missing a value the template needs: keep the text recorded at the time.
  const needed = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (needed.some((k) => !(k in vars))) return entry.summary;
  return fmt(template, vars);
}
