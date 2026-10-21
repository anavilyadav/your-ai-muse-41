import { cn } from "@/lib/utils";

// "Online" / "Courier" marks for a patient (patients.is_online /
// uses_courier, migration 0091) — shown wherever staff call or look up
// patients, so a courier patient is never treated like a walk-in.
export function RemoteBadges({
  patient,
  className,
}: {
  patient: { is_online?: boolean | null; uses_courier?: boolean | null } | null | undefined;
  className?: string;
}) {
  if (!patient?.is_online && !patient?.uses_courier) return null;
  return (
    <span className={cn("inline-flex flex-wrap gap-1 align-middle", className)}>
      {patient.is_online && (
        <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-px text-[10px] font-bold text-sky-700 dark:text-sky-300">
          🌐 Online
        </span>
      )}
      {patient.uses_courier && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-bold text-amber-700 dark:text-amber-300">
          📦 Courier
        </span>
      )}
    </span>
  );
}
