"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const t = useI18n().t.common.login;
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t.email}
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state.email}
          className="rounded-lg border border-zinc-300 px-3 py-2.5 font-normal outline-none focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20 transition"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t.password}
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border border-zinc-300 px-3 py-2.5 font-normal outline-none focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20 transition"
        />
      </label>
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t.submit}
      </button>
    </form>
  );
}
