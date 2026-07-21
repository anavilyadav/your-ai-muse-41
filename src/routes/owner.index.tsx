import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutDashboard, Users, TrendingUp, Settings, Activity, Target } from "lucide-react";
import { RoleShell, Stat, type NavItem } from "@/components/yhc/RoleShell";
import { WEEK_REVENUE } from "@/lib/yhc-owner";

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

function OwnerDashboard() {
  const max = Math.max(...WEEK_REVENUE.map((w) => w[1]));
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
      <div className="rounded-2xl bg-primary text-primary-foreground p-5 text-center">
        <div className="text-[13px] text-primary-foreground/70">Today's Revenue</div>
        <div className="text-4xl font-extrabold text-accent mt-1">₹9,600</div>
        <div className="flex justify-center gap-4 mt-2 text-[12px] text-primary-foreground/70">
          <span>Bajaj: ₹5,800</span>
          <span>Jagatpura: ₹3,800</span>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Stat v={42} l="Patients" />
        <Stat v={8} l="New" tone="success" />
        <Stat v={34} l="Follow-up" />
        <Stat v="₹2.1L" l="This Month" tone="accent" />
      </div>

      <div className="mt-3 rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          This Week — Revenue
        </div>
        <div className="flex items-end gap-2 h-32">
          {WEEK_REVENUE.map(([d, v]) => (
            <div key={d} className="flex-1 flex flex-col items-center gap-1">
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
          <div className="font-bold text-primary text-sm mt-1">Staff (8)</div>
          <div className="text-[11px] text-muted-foreground">7 active, 1 leave</div>
        </Link>
      </div>
    </RoleShell>
  );
}
