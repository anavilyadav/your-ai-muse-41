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
//
// FIXED (master audit, 17 Sep 2026, RF-24): the banner always said "RPC
// fallback alert" no matter what `system_alerts` actually held — but that
// table has grown well past just RPC-fallback logging since this was
// written (nightly_data_health warnings, Google Sheets backup failures,
// stale-visit warnings all land here too). A real, live example: 50+
// alerts on screen, almost none of them about a missing RPC — the Owner
// would go looking for a nonexistent SQL-migration problem instead of the
// real WhatsApp-delivery or backup issue underneath. Wording is now
// content-neutral; Health itself is still the place to see what each one
// actually is.
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
        ⚠ {count} system alert{count > 1 ? "s" : ""} pending hain
      </span>
      <span className="shrink-0 underline">Health dekho →</span>
    </Link>
  );
}
