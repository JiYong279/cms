import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getT } from "@/i18n/server";

export async function NoAccess({ message }: { message?: string }) {
  const t = (await getT()).common.noAccess;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <ShieldAlert className="size-10 text-zinc-300" />
      <h1 className="text-lg font-semibold">{t.title}</h1>
      <p className="max-w-sm text-sm text-zinc-500">{message ?? t.message}</p>
      <Link href="/admin" className="mt-2 text-sm font-medium text-brand hover:text-brand-hover">
        {t.back}
      </Link>
    </div>
  );
}
