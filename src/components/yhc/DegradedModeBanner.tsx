import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchSystemAlerts } from "@/lib/db";

// 04 Aug 2026 — Part 3 pending item ("degraded-mode banners"). Every
// "atomic" fix in db.ts falls back to an older, less-safe path if its RPC
// is missing (SQL migration not run yet) and logs that via
// logDegradedModeAlert() -- but until now the only place that showed up
// was /owner/health, which Owner had to remember to open. A fallback could
// sit unnoticed for weeks. This surfaces the same alert count on every
// Owner screen, linking to Health for the full list + resolve action.
//
// Owner-only by design: reception/pharmacy/doctor staff can't act on these
// (fixing one means running SQL in the Supabase Dashboard), so showing it
// to them would just be noise they have no way to resolve. RoleShell
// renders this conditionally on the logged-in user's real role.
export function DegradedModeBanner() {
  const { data } = useQuery({ queryKey: ["system-alerts"], queryFn: fetchSystemAlerts });
  const count = data?.length ?? 0;
  if (count === 0) return null;

  return (
    <Link
      to="/owner/health"
      className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] font-semibold text-destructive"
    >
      <span>
        ⚠ {count} RPC fallback alert{count > 1 ? "s" : ""} — app kam-safe path pe chal raha hai
      </span>
      <span className="shrink-0 underline">Health dekho →</span>
    </Link>
  );
}
