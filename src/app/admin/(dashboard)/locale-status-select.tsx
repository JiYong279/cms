"use client";

import { useRouter } from "next/navigation";

type Props = {
  /** The address parameter: the language code ("vi", "en"). */
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
};

/** "VI version: Draft": filters the article list by the status of one language, applied on change. */
export function LocaleStatusSelect({ name, label, value, options }: Props) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-500">
      {label}
      <select
        name={name}
        value={value ?? ""}
        onChange={(e) => {
          // The other filters, the search and the sort stay as they are.
          const params = new URLSearchParams(window.location.search);
          if (e.target.value) params.set(name, e.target.value);
          else params.delete(name);
          const query = params.toString();
          router.push(query ? `/admin?${query}` : "/admin");
        }}
        className="rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-2 pr-7 text-sm text-zinc-800 outline-none focus:border-brand-bright focus:bg-white focus:ring-2 focus:ring-brand-bright/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
