"use client";

import { useActionState } from "react";
import type { Role } from "@/db/schema";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import { useI18n } from "@/i18n/client";
import { ROLES } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { createUser, resetPassword, updateUser, type FormState } from "./actions";

function RolePicker({ defaultValue, disabled }: { defaultValue: Role; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-zinc-700">{t.users.form.role}</legend>
      {ROLES.map((role) => (
        <label
          key={role}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 p-3 has-checked:border-brand-bright has-checked:bg-brand-soft",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input type="radio" name="role" value={role} defaultChecked={role === defaultValue} className="mt-1" />
          <span>
            <span className="block text-sm font-medium">{t.common.roles[role]}</span>
            <span className="block text-xs text-zinc-500">{t.common.roleDescriptions[role]}</span>
          </span>
        </label>
      ))}
      {/* A disabled fieldset submits nothing, so keep the current role in the form. */}
      {disabled && <input type="hidden" name="role" value={defaultValue} />}
    </fieldset>
  );
}

export function CreateUserForm() {
  const { t } = useI18n();
  const [state, action] = useActionState<FormState, FormData>(createUser, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t.users.form.name}>
          <input name="name" required className={inputClass} />
        </Field>
        <Field label={t.users.form.email}>
          <input name="email" type="email" required autoComplete="off" className={inputClass} />
        </Field>
      </div>
      <Field label={t.users.form.initialPassword} hint={t.users.form.initialPasswordHint}>
        <input name="password" type="text" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <RolePicker defaultValue="writer" />
      <FormMessage state={state} />
      <SubmitButton>{t.users.form.create}</SubmitButton>
    </form>
  );
}

type EditableUser = { id: string; name: string; email: string; role: Role; active: boolean };

export function EditUserForm({ user, isSelf }: { user: EditableUser; isSelf: boolean }) {
  const { t } = useI18n();
  const [state, action] = useActionState<FormState, FormData>(updateUser, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={user.id} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t.users.form.name}>
          <input name="name" required defaultValue={user.name} className={inputClass} />
        </Field>
        <Field label={t.users.form.email} hint={t.users.form.emailFixed}>
          <input value={user.email} disabled className={inputClass} />
        </Field>
      </div>
      <RolePicker defaultValue={user.role} disabled={isSelf} />
      <label className={cn("flex items-start gap-3 text-sm", isSelf && "opacity-60")}>
        <input type="checkbox" name="active" defaultChecked={user.active} disabled={isSelf} className="mt-1" />
        <span>
          <span className="block font-medium">{t.users.form.allowLogin}</span>
          <span className="block text-xs text-zinc-500">{t.users.form.allowLoginHint}</span>
        </span>
      </label>
      {/* A disabled checkbox is not submitted; you can never lock yourself out. */}
      {isSelf && <input type="hidden" name="active" value="on" />}
      {isSelf && <p className="text-xs text-zinc-500">{t.users.form.selfNote}</p>}
      <FormMessage state={state} />
      <SubmitButton>{t.users.form.saveChanges}</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState<FormState, FormData>(resetPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={userId} />
      <Field label={t.users.form.newPassword} hint={t.users.form.resetHint}>
        <input name="password" type="text" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="secondary">{t.users.form.reset}</SubmitButton>
    </form>
  );
}
