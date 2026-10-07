import Link from "next/link";
import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import { getDb, schema } from "@/db";
import { NoAccess } from "@/components/no-access";
import { getT, getTimeZone } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { EDITABLE_PERMISSIONS, EDITABLE_ROLES, ROLE_BADGE, can, type EditableRole, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { RolePermissionsForm } from "./role-permissions-form";
import { UserRoleSelect } from "./user-role-select";
import { UserRowActions } from "./user-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.users.list.metaTitle} · ${t.common.appName}` };
}

function formatDate(date: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(date);
}

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const me = await requireUser();
  const t = await getT();
  if (!can(me.role, "users.manage")) return <NoAccess message={t.users.noAccess.list} />;
  const timeZone = await getTimeZone();

  // Active accounts, or the disabled ones kept apart (?view=disabled).
  const disabledView = (await searchParams).view === "disabled";
  const db = await getDb();
  const everyone = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      active: schema.users.active,
      createdAt: schema.users.createdAt,
      posts: count(schema.posts.id),
    })
    .from(schema.users)
    .leftJoin(schema.posts, eq(schema.posts.authorId, schema.users.id))
    .groupBy(schema.users.id)
    .orderBy(asc(schema.users.createdAt));
  const users = everyone.filter((u) => u.active !== disabledView);
  const counts = { active: everyone.filter((u) => u.active).length, disabled: everyone.filter((u) => !u.active).length };
  // What editors and writers may do now, with the admin's saved changes (loaded by requireUser).
  const grants = Object.fromEntries(
    EDITABLE_ROLES.map((role) => [role, EDITABLE_PERMISSIONS.filter((p) => can(role, p))]),
  ) as Record<EditableRole, Permission[]>;
  const tabs = [
    { href: "/admin/users", label: t.users.list.tabActive, n: counts.active, current: !disabledView },
    { href: "/admin/users?view=disabled", label: t.users.list.tabDisabled, n: counts.disabled, current: disabledView },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.users.list.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t.users.list.subtitle}</p>
        </div>
        <Link
          href="/admin/users/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-hover"
        >
          <UserPlus className="size-4" />
          {t.users.list.add}
        </Link>
      </header>

      <nav aria-label={t.users.list.tabsLabel} className="mt-6 flex gap-1 border-b border-zinc-200">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.current ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium",
              tab.current ? "border-brand text-ink" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {tab.label}
            <span className={cn("rounded-full px-1.5 py-px text-xs", tab.current ? "bg-brand-soft text-brand" : "bg-zinc-100 text-zinc-500")}>{tab.n}</span>
          </Link>
        ))}
      </nav>
      {disabledView && <p className="mt-4 text-sm text-zinc-500">{t.users.list.disabledNote}</p>}

      <section className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t.users.list.colUser}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colRole}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colStatus}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colPosts}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colCreated}</th>
              <th className="px-4 py-3 text-right font-medium">{t.users.list.colActions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users.map((u) => (
              <tr key={u.id} className={cn("hover:bg-zinc-50", !u.active && "text-zinc-400")}>
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:text-brand">
                    {u.name}
                    {u.id === me.id && <span className="ml-2 text-xs font-normal text-zinc-400">{t.users.list.you}</span>}
                  </Link>
                  <div className="text-xs text-zinc-500">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  {u.id === me.id ? (
                    <span title={t.users.list.ownRole} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROLE_BADGE[u.role])}>
                      {t.common.roles[u.role]}
                    </span>
                  ) : (
                    // Keyed by role: after a change elsewhere (the user's page), the select starts from the saved role.
                    <UserRoleSelect key={u.role} id={u.id} name={u.name} role={u.role} />
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {u.active ? (
                    <span className="text-emerald-700">{t.users.list.active}</span>
                  ) : (
                    <span className="text-zinc-400">{t.users.list.locked}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-600">{u.posts}</td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                  <time dateTime={u.createdAt.toISOString()}>{formatDate(u.createdAt, t.common.dateLocale, timeZone)}</time>
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== me.id && <UserRowActions id={u.id} name={u.name} active={u.active} />}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">
                  {t.users.list.emptyDisabled}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">{t.users.list.matrixTitle}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t.users.list.matrixSubtitle}</p>
        <RolePermissionsForm grants={grants} />
      </section>
    </div>
  );
}
