"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookA,
  FileText,
  FolderTree,
  Image as ImageIcon,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { LanguageSwitch } from "@/components/language-switch";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const ICONS = {
  posts: FileText,
  users: Users,
  settings: Settings,
  activity: Activity,
  categories: FolderTree,
  media: ImageIcon,
  glossary: BookA,
} satisfies Record<string, LucideIcon>;

export type ShellNavItem = { href: string | null; label: string; icon: keyof typeof ICONS };
export type ShellNavGroup = { title: string; items: ShellNavItem[] };

type Props = {
  groups: ShellNavGroup[];
  user: { name: string; roleLabel: string } | null;
  logout: () => Promise<void>;
  children: React.ReactNode;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function isActive(pathname: string, href: string) {
  // "/admin" is the posts list; its editor lives under /admin/posts.
  if (href === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/posts");
  return pathname.startsWith(href);
}

export function Shell({ groups, user, logout, children }: Props) {
  const { t } = useI18n();
  const pathname = usePathname();
  // The drawer belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-white">
      <Link href="/admin" className="flex h-16 shrink-0 items-center px-5">
        <Brand onDark />
      </Link>

      <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-5">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                if (!item.href) {
                  return (
                    <li key={item.label}>
                      <span className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/35">
                        <Icon className="size-4" />
                        {item.label}
                        <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white/40">
                          {t.common.nav.soon}
                        </span>
                      </span>
                    </li>
                  );
                }
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className={cn(
                        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        active ? "bg-white/10 font-semibold text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      {active && <span className="absolute -left-3 bottom-1.5 top-1.5 w-1 rounded-r bg-brand-light" />}
                      <Icon className={cn("size-4", active && "text-brand-light")} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">{t.common.language}</span>
        <LanguageSwitch onDark />
      </div>
      {user && (
        <div className="flex items-center gap-1 border-t border-white/10 p-3">
          <Link
            href="/admin/account"
            title={t.common.nav.account}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
              {initials(user.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{user.name}</span>
              <span className="block truncate text-xs text-white/50">{user.roleLabel}</span>
            </span>
          </Link>
          <form action={logout}>
            <button
              type="submit"
              title={t.common.nav.logout}
              aria-label={t.common.nav.logout}
              className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-canvas text-zinc-900 md:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 md:block">{sidebar}</aside>

      {/* Mobile top bar and drawer */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur md:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label={t.common.nav.openMenu} className="-ml-2 rounded-lg p-2 hover:bg-zinc-100">
          <Menu className="size-5" />
        </button>
        <Brand />
      </header>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.common.nav.closeMenu}
              className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
