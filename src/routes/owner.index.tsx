import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Users, TrendingUp, Settings, Activity, Target, Upload, CalendarClock, CalendarCheck, Wallet, ClipboardList, MessageCircle, ShieldCheck } from "lucide-react";
import { RoleShell, Stat, type NavItem } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchOwnerStats, fetchWeekRevenue, fetchStaff } from "@/lib/db";
import { RoleSwitcher } from "@/components/yhc/RoleSwitcher";

export const Route = createFileRoute("/owner/")({
  head: () => ({ meta: [{ title: "Owner Dashboard — YHC" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <OwnerDashboard />
    </AuthGate>
  ),
});

export const OWNER_NAV: NavItem[] = [
  { to: "/owner", label: "Home", icon: LayoutDashboard, exact: true },
  { to: "/owner/staff", label: "Staff", icon: Users },
  { to: "/owner/reports", label: "Reports", icon: TrendingUp },
  { to: "/owner/control", label: "Control", icon: Settings },
  { to: "/owner/import", label: "Import", icon: Upload },
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
    <RoleShell wide
      title="Owner Dashboard"
      subtitle="Yadav Homeo Clinic • Both Branches"
      nav={OWNER_NAV}
      right={
        <div className="flex items-center gap-1.5">
          <RoleSwitcher />
          <Link
            to="/owner/health"
            className="rounded-full bg-white/15 text-primary-foreground text-[11px] px-3 py-1.5 font-semibold inline-flex items-center gap-1"
          >
            <Activity className="h-3.5 w-3.5" /> Health
          </Link>
        </div>
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
            <Link to="/appointments" className="rounded-2xl bg-surface border border-border p-3.5">
              <CalendarCheck className="h-5 w-5 text-primary" />
              <div className="font-bold text-primary text-sm mt-1">Appointments</div>
              <div className="text-[11px] text-muted-foreground">Book · slot & time settings</div>
            </Link>
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
            <Link to="/owner/followup-rules" className="rounded-2xl bg-surface border border-border p-3.5">
              <CalendarClock className="h-5 w-5 text-accent-foreground" />
              <div className="font-bold text-primary text-sm mt-1">Follow-up Rules</div>
              <div className="text-[11px] text-muted-foreground">Reminder sequences</div>
            </Link>
            <Link to="/owner/winback-tiers" className="rounded-2xl bg-surface border border-border p-3.5">
              <Target className="h-5 w-5 text-destructive" />
              <div className="font-bold text-primary text-sm mt-1">Win-back Tiers</div>
              <div className="text-[11px] text-muted-foreground">Lapsed patients</div>
            </Link>
            <Link to="/owner/holidays" className="rounded-2xl bg-surface border border-border p-3.5">
              <CalendarClock className="h-5 w-5 text-success" />
              <div className="font-bold text-primary text-sm mt-1">Holidays</div>
              <div className="text-[11px] text-muted-foreground">Greeting broadcasts</div>
            </Link>
            <Link to="/owner/payment-adjustments" className="rounded-2xl bg-surface border border-border p-3.5">
              <Wallet className="h-5 w-5 text-destructive" />
              <div className="font-bold text-primary text-sm mt-1">Payment Adjustments</div>
              <div className="text-[11px] text-muted-foreground">Overpayment refund/credit</div>
            </Link>
            <Link to="/owner/case-tracking" className="rounded-2xl bg-surface border border-border p-3.5">
              <ClipboardList className="h-5 w-5 text-destructive" />
              <div className="font-bold text-primary text-sm mt-1">Case Tracking</div>
              <div className="text-[11px] text-muted-foreground">Online + walk-in, pending discussion</div>
            </Link>
            <Link to="/owner/whatsapp" className="rounded-2xl bg-surface border border-border p-3.5">
              <MessageCircle className="h-5 w-5 text-success" />
              <div className="font-bold text-primary text-sm mt-1">WhatsApp Delivery</div>
              <div className="text-[11px] text-muted-foreground">Sent / failed / opt-out</div>
            </Link>
            <Link to="/owner/audit-log" className="rounded-2xl bg-surface border border-border p-3.5">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div className="font-bold text-primary text-sm mt-1">Audit Log</div>
              <div className="text-[11px] text-muted-foreground">Har change ka record</div>
            </Link>
          </div>
        </>
      )}
    </RoleShell>
  );
}
