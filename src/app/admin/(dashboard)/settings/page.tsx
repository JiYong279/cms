import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { Card } from "@/components/form";
import { NoAccess } from "@/components/no-access";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CreateSiteForm, EditSiteForm } from "./site-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.users.settings.metaTitle} · ${t.common.appName}` };
}

export default async function SettingsPage() {
  const me = await requireUser();
  const t = await getT();
  if (!can(me.role, "sites.manage")) return <NoAccess message={t.users.settings.noAccess.edit} />;

  const db = await getDb();
  const sites = await db.select().from(schema.sites).orderBy(asc(schema.sites.name));
  const secretSet = !!process.env.CMS_REVALIDATE_SECRET;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t.users.settings.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {t.users.settings.intro}{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">{t.users.settings.apiPath}</code>.
      </p>
      {!secretSet && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t.users.settings.missingSecretBefore} <code className="font-mono">CMS_REVALIDATE_SECRET</code>
          {t.users.settings.missingSecretAfter}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-6">
        {sites.map((site) => (
          <Card key={site.id} title={site.name} description={site.baseUrl}>
            <EditSiteForm
              site={{
                id: site.id,
                name: site.name,
                baseUrl: site.baseUrl,
                blogPathVi: site.blogPaths.vi,
                blogPathEn: site.blogPaths.en,
                defaultLocale: site.defaultLocale,
                revalidateUrl: site.revalidateUrl ?? "",
              }}
            />
          </Card>
        ))}
        <details className="group rounded-xl border border-dashed border-zinc-300 bg-white p-6 open:border-solid open:shadow-sm">
          <summary className="cursor-pointer list-none font-semibold text-brand group-open:mb-5 group-open:text-zinc-900">
            {t.users.settings.addOther}
          </summary>
          <CreateSiteForm />
        </details>
      </div>
    </div>
  );
}
