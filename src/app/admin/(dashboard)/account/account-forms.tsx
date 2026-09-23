"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import { useI18n } from "@/i18n/client";
import type { FormState } from "../users/actions";
import { changePassword, updateProfile } from "./actions";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState<FormState, FormData>(updateProfile, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t.users.account.name}>
        <input name="name" required defaultValue={name} className={inputClass} />
      </Field>
      <Field label={t.users.account.email} hint={t.users.account.emailHint}>
        <input value={email} disabled className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>{t.common.save}</SubmitButton>
    </form>
  );
}

export function ChangePasswordForm() {
  const { t } = useI18n();
  const [state, action] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t.users.account.currentPassword}>
        <input name="current" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Field label={t.users.account.newPassword} hint={t.users.account.newPasswordHint}>
        <input name="next" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <Field label={t.users.account.confirmPassword}>
        <input name="confirm" type="password" required autoComplete="new-password" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>{t.users.account.changePassword}</SubmitButton>
    </form>
  );
}
