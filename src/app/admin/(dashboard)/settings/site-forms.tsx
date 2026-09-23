"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import { useI18n } from "@/i18n/client";
import type { FormState } from "../users/actions";
import { createSite, testSiteConnection, updateSite } from "./actions";

export type SiteFormValue = {
  id: string;
  name: string;
  baseUrl: string;
  blogPathVi: string;
  blogPathEn: string;
  defaultLocale: "vi" | "en";
  revalidateUrl: string;
};

function SiteFields({ site, isNew }: { site: SiteFormValue; isNew: boolean }) {
  const { t } = useI18n();
  const s = t.users.settings;
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={s.name}>
          <input name="name" required defaultValue={site.name} className={inputClass} />
        </Field>
        <Field label={s.id} hint={isNew ? s.idHintNew : s.idHintFixed}>
          {isNew ? (
            <input name="id" required defaultValue={site.id} className={`${inputClass} font-mono`} />
          ) : (
            <>
              <input value={site.id} disabled className={`${inputClass} font-mono`} />
              <input type="hidden" name="id" value={site.id} />
            </>
          )}
        </Field>
      </div>
      <Field label={s.domain} hint={s.domainHint}>
        <input name="baseUrl" required type="url" defaultValue={site.baseUrl} placeholder="https://www.qub-x.com" className={inputClass} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={s.blogVi}>
          <input name="blogPathVi" required defaultValue={site.blogPathVi} className={`${inputClass} font-mono`} />
        </Field>
        <Field label={s.blogEn}>
          <input name="blogPathEn" required defaultValue={site.blogPathEn} className={`${inputClass} font-mono`} />
        </Field>
        <Field label={s.firstLocale}>
          <select name="defaultLocale" defaultValue={site.defaultLocale} className={inputClass}>
            <option value="vi">{t.common.locales.vi}</option>
            <option value="en">{t.common.locales.en}</option>
          </select>
        </Field>
      </div>
      <Field label={s.revalidateUrl} hint={s.revalidateHint}>
        <input
          name="revalidateUrl"
          type="url"
          defaultValue={site.revalidateUrl}
          placeholder="https://www.qub-x.com/api/cms/revalidate"
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
    </>
  );
}

export function EditSiteForm({ site }: { site: SiteFormValue }) {
  const { t } = useI18n();
  const [state, action] = useActionState<FormState, FormData>(updateSite, {});
  const [testState, testAction] = useActionState<FormState, FormData>(testSiteConnection, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <SiteFields site={site} isNew={false} />
      <FormMessage state={state} />
      <FormMessage state={testState} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton>{t.users.settings.save}</SubmitButton>
        {/* Tests the URL currently typed in the form, before or after saving. */}
        <button
          formAction={testAction}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
        >
          {t.users.settings.test}
        </button>
      </div>
    </form>
  );
}

export function CreateSiteForm() {
  const { t } = useI18n();
  const [state, action] = useActionState<FormState, FormData>(createSite, {});
  const empty: SiteFormValue = {
    id: "",
    name: "",
    baseUrl: "",
    blogPathVi: "/vi/blog",
    blogPathEn: "/blog",
    defaultLocale: "vi",
    revalidateUrl: "",
  };
  return (
    <form action={action} className="flex flex-col gap-5">
      <SiteFields site={empty} isNew />
      <FormMessage state={state} />
      <SubmitButton>{t.users.settings.add}</SubmitButton>
    </form>
  );
}
