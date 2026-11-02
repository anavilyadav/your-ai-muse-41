import { today } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// One look for "which day is this group" on every list that is split by date
// (Dr. Yadav, 28 Oct 2026: the date line was too faint to notice when the day
// changed, and it must look the same on every screen).
// Aaj is green-gold, a future day is outlined. An older day was navy, the same
// as the rest of the app, so staff could not see where one day ended (2 Nov
// 2026) — older days now take turns between teal and plum, day by day.
export function DayHeader({
  date,
  label,
  className,
}: {
  /** YYYY-MM-DD */
  date: string;
  /** Right-hand side, e.g. "7 pending" or "3 case". */
  label?: string;
  className?: string;
}) {
  const t = today();
  const d = new Date(`${date}T00:00:00`);
  const full = d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const kind = date === t ? "today" : date < t ? "past" : "future";
  // next-door dates always get different colours (day number odd/even)
  const odd = Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000) % 2 === 1;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl px-3 py-2 mt-2 mb-1",
        kind === "today" && "bg-accent text-accent-foreground",
        kind === "past" && (odd ? "bg-day-a text-day-a-foreground" : "bg-day-b text-day-b-foreground"),
        kind === "future" && "bg-surface text-primary border-2 border-primary",
        className,
      )}
    >
      <span className="text-[13px] font-extrabold tracking-wide">
        📅 {kind === "today" ? "AAJ" : kind === "future" ? "AAGE" : "PURANI TAREEKH"} • {full}
      </span>
      {label && <span className="text-[11px] font-bold opacity-90 shrink-0">{label}</span>}
    </div>
  );
}
