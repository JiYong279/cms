import Link from "next/link";
import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { Check, Minus, UserPlus } from "lucide-react";
import { getDb, schema } from "@/db";
import { NoAccess } from "@/components/no-access";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS, ROLES, ROLE_BADGE, can, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.users.list.metaTitle} · ${t.common.appName}` };
}

function formatDate(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export default async function UsersPage() {
  const me = await requireUser();
  const t = await getT();
  if (!can(me.role, "users.manage")) return <NoAccess message={t.users.noAccess.list} />;

  const db = await getDb();
  const users = await db
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

      <section className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t.users.list.colUser}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colRole}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colStatus}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colPosts}</th>
              <th className="px-4 py-3 font-medium">{t.users.list.colCreated}</th>
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
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROLE_BADGE[u.role])}>
                    {t.common.roles[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {u.active ? (
                    <span className="text-emerald-700">{t.users.list.active}</span>
                  ) : (
                    <span className="text-zinc-400">{t.users.list.locked}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-600">{u.posts}</td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{formatDate(u.createdAt, t.common.dateLocale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">{t.users.list.matrixTitle}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t.users.list.matrixSubtitle}</p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t.users.list.colPermission}</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-4 py-3 text-center font-medium">
                    {t.common.roles[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
                <tr key={p}>
                  <td className="px-4 py-2.5">{t.common.permissions[p]}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-4 py-2.5">
                      {can(r, p) ? (
                        <Check className="mx-auto size-4 text-emerald-600" aria-label={t.users.list.yes} />
                      ) : (
                        <Minus className="mx-auto size-4 text-zinc-300" aria-label={t.users.list.no} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
