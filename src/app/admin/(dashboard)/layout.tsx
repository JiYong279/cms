import { logout } from "@/app/login/actions";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Shell, type ShellNavGroup } from "./shell";

export default async function DashboardLayout({ children }: LayoutProps<"/admin">) {
  // Display only: each page and action checks the session itself.
  const user = await getCurrentUser();
  const t = await getT();
  const { nav } = t.common;

  const groups: ShellNavGroup[] = [
    {
      title: nav.content,
      items: [
        { href: "/admin", label: nav.posts, icon: "posts" },
        { href: user && can(user.role, "categories.manage") ? "/admin/categories" : null, label: nav.categories, icon: "categories" },
        { href: null, label: nav.media, icon: "media" },
        { href: null, label: nav.glossary, icon: "glossary" },
      ],
    },
  ];
  const system: ShellNavGroup["items"] = [];
  if (user && can(user.role, "activity.view")) system.push({ href: "/admin/activity", label: nav.activity, icon: "activity" });
  if (user && can(user.role, "users.manage")) system.push({ href: "/admin/users", label: nav.users, icon: "users" });
  if (user && can(user.role, "sites.manage")) system.push({ href: "/admin/settings", label: nav.settings, icon: "settings" });
  if (system.length > 0) groups.push({ title: nav.system, items: system });

  return (
    <Shell groups={groups} user={user && { name: user.name, roleLabel: t.common.roles[user.role] }} logout={logout}>
      {children}
    </Shell>
  );
}
