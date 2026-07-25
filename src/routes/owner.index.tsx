import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Users, TrendingUp, Settings, Activity, Target } from "lucide-react";
import { RoleShell, Stat, type NavItem } from "@/components/yhc/RoleShell";
import { LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchOwnerStats, fetchWeekRevenue, fetchStaff } from "@/lib/db";

export const Route = createFileRoute("/owner/")({
  head: () => ({ meta: [{ title: "Owner Dashboard — YHC" }, { name: "robots", content: "noindex" }] }),
  component: OwnerDashboard,
});

export const OWNER_NAV: NavItem[] = [
  { to: "/owner", label: "Home", icon: LayoutDashboard, exact: true },
  { to: "/owner/staff", label: "Staff", icon: Users },
  { to: "/owner/reports", label: "Reports", icon: TrendingUp },
  { to: "/owner/control", label: "Control", icon: Settings },
];

function inr(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n}`;
}

function OwnerDashboard() {
  const stats = useQuery({ queryKey: ["owner-stats"], queryFn: fetchOwnerStats, refetchInterval: 30_000 });
  const week = useQuery({ queryKey: ["owner-week"], queryFn: fetchWeekRevenue });
  const staff = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const s = stats.data;
  const w = week.data ?? [];
  const max = Math.max(1, ...w.map((x) => x[1]));
  const staffCount = staff.data?.length ?? 0;
  const activeStaff = (staff.data ?? []).filter((u: any) => (u.status ?? "Active") === "Active").length;

  return (
    <RoleShell
      title="Owner Dashboard"
      subtitle="Yadav Homeo Clinic • Both Branches"
      nav={OWNER_NAV}
      right={
        <Link
          to="/owner/health"
          className="rounded-full bg-white/15 text-primary-foreground text-[11px] px-3 py-1.5 font-semibold inline-flex items-center gap-1"
        >
          <Activity className="h-3.5 w-3.5" /> Health
        </Link>
      }
    >
      {stats.isLoading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="rounded-2xl bg-primary text-primary-foreground p-5 text-center">
            <div className="text-[13px] text-primary-foreground/70">Today's Revenue</div>
            <div className="text-4xl font-extrabold text-accent mt-1">{inr(s?.todayRevenue ?? 0)}</div>
            <div className="flex justify-center gap-4 mt-2 text-[12px] text-primary-foreground/70">
              <span>Bajaj: {inr(s?.todayRevenueBajaj ?? 0)}</span>
              <span>Jagatpura: {inr(s?.todayRevenueJagatpura ?? 0)}</span>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <Stat v={s?.todayVisits ?? 0} l="Patients" />
            <Stat v={s?.newToday ?? 0} l="New" tone="success" />
            <Stat v={s?.followupsToday ?? 0} l="Follow-up" />
            <Stat v={inr(s?.monthRevenue ?? 0)} l="This Month" tone="accent" />
          </div>

          <div className="mt-3 rounded-2xl bg-surface border border-border p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              This Week — Revenue
            </div>
            <div className="flex items-end gap-2 h-32">
              {w.map(([d, v], i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[9px] text-muted-foreground font-semibold">{(v / 1000).toFixed(1)}k</div>
                  <div
                    className="w-full bg-accent rounded-t-md"
                    style={{ height: `${(v / max) * 90}px` }}
                  />
                  <div className="text-[11px] text-muted-foreground">{d}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/owner/incentives" className="rounded-2xl bg-surface border border-border p-3.5">
              <Target className="h-5 w-5 text-accent-foreground" />
              <div className="font-bold text-primary text-sm mt-1">Incentives</div>
              <div className="text-[11px] text-muted-foreground">Staff performance</div>
            </Link>
            <Link to="/owner/staff" className="rounded-2xl bg-surface border border-border p-3.5">
              <Users className="h-5 w-5 text-primary" />
              <div className="font-bold text-primary text-sm mt-1">Staff ({staffCount})</div>
              <div className="text-[11px] text-muted-foreground">{activeStaff} active</div>
            </Link>
          </div>
        </>
      )}
    </RoleShell>
  );
}
