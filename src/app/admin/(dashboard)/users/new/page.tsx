import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/form";
import { NoAccess } from "@/components/no-access";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CreateUserForm } from "../user-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.users.new.metaTitle} · ${t.common.appName}` };
}

export default async function NewUserPage() {
  const me = await requireUser();
  const t = await getT();
  if (!can(me.role, "users.manage")) return <NoAccess message={t.users.noAccess.create} />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" />
        {t.users.new.back}
      </Link>
      <h1 className="mt-3 mb-6 text-2xl font-semibold">{t.users.new.title}</h1>
      <Card title={t.users.new.card}>
        <CreateUserForm />
      </Card>
    </div>
  );
}
