/** Building blocks of the editor's side panel. */

export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20 disabled:bg-zinc-100";

export function Section({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-4 px-5 py-5">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
      <span className="flex items-center justify-between">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}
