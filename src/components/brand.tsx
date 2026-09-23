import { cn } from "@/lib/utils";

/** Qub-X wordmark with a "Studio" tag. White artwork on dark backgrounds. */
export function Brand({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img
        src={onDark ? "/brand/qubx-logo-white-600.png" : "/brand/qubx-logo-dark-600.png"}
        alt="Qub-X"
        width={1200}
        height={359}
        className="h-7 w-auto"
      />
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em]",
          onDark ? "bg-white/10 text-brand-light" : "bg-brand-tint text-brand",
        )}
      >
        Studio
      </span>
    </span>
  );
}
