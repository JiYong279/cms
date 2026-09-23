import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/form";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS, ROLE_BADGE, can, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ChangePasswordForm, ProfileForm } from "./account-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.users.account.metaTitle} · ${t.common.appName}` };
}

export default async function AccountPage({ searchParams }: PageProps<"/admin/account">) {
  const me = await requireUser();
  const t = await getT();
  const { weak } = await searchParams;
  const granted = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(me.role, p));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t.users.account.title}</h1>
      {weak === "1" && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">{t.users.account.weakTitle}</p>
            <p className="mt-1 text-amber-800">{t.users.account.weakMessage}</p>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-6">
        <Card title={t.users.account.profileCard}>
          <ProfileForm name={me.name} email={me.email} />
        </Card>
        <Card title={t.users.account.roleCard}>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROLE_BADGE[me.role])}>
            {t.common.roles[me.role]}
          </span>
          <ul className="mt-3 list-disc pl-5 text-sm text-zinc-600">
            {granted.map((p) => (
              <li key={p}>{t.common.permissions[p]}</li>
            ))}
          </ul>
        </Card>
        <div id="doi-mat-khau">
          <Card title={t.users.account.passwordCard}>
            <ChangePasswordForm />
          </Card>
        </div>
      </div>
    </div>
  );
}
