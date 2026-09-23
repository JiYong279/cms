import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { Card } from "@/components/form";
import { NoAccess } from "@/components/no-access";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { EditUserForm, ResetPasswordForm } from "../user-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.users.edit.metaTitle} · ${t.common.appName}` };
}

export default async function EditUserPage({ params }: PageProps<"/admin/users/[id]">) {
  const me = await requireUser();
  const t = await getT();
  if (!can(me.role, "users.manage")) return <NoAccess message={t.users.noAccess.edit} />;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = await getDb();
  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      active: schema.users.active,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  if (!user) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" />
        {t.users.edit.back}
      </Link>
      <h1 className="mt-3 mb-6 text-2xl font-semibold">{user.name}</h1>
      <div className="flex flex-col gap-6">
        <Card title={t.users.edit.infoCard}>
          <EditUserForm user={user} isSelf={user.id === me.id} />
        </Card>
        <Card title={t.users.edit.resetCard} description={t.users.edit.resetDescription}>
          <ResetPasswordForm userId={user.id} />
        </Card>
      </div>
    </div>
  );
}
