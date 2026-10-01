import { redirect } from "next/navigation";
import { Globe2, Languages, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { LanguageSwitch } from "@/components/language-switch";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { HOME_PATH } from "@/lib/paths";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t.common.login.metaTitle} · ${t.common.appName}` };
}

export default async function LoginPage() {
  if (await getCurrentUser()) redirect(HOME_PATH);
  const t = (await getT()).common.login;
  const highlights = [
    { icon: Languages, text: t.highlightBilingual },
    { icon: Globe2, text: t.highlightPublish },
    { icon: ShieldCheck, text: t.highlightRoles },
  ];

  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col">
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_85%_12%,rgba(90,212,154,0.28),transparent_26rem),radial-gradient(circle_at_10%_95%,rgba(10,107,69,0.55),transparent_24rem)]"
          aria-hidden
        />
        <div className="absolute -bottom-24 -left-16 size-72 rounded-full border-[48px] border-brand/50" aria-hidden />
        <div className="relative">
          <Brand onDark />
        </div>
        <div className="relative mt-auto max-w-md">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-light">{t.tagline}</p>
          <h2 className="mt-4 text-4xl font-extrabold leading-tight tracking-[-0.03em]">
            {t.headline1}
            <br />
            {t.headline2}
          </h2>
          <ul className="mt-8 space-y-4">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/75">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-light">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative flex items-center justify-center px-6 py-12">
        <LanguageSwitch className="absolute right-6 top-6" />
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-ink">{t.title}</h1>
          <p className="mt-2 text-sm text-ink-soft">{t.subtitle}</p>
          <div className="mt-8">
            <LoginForm />
          </div>
          <p className="mt-8 text-xs text-zinc-400">{t.forgot}</p>
        </div>
      </section>
    </div>
  );
}
