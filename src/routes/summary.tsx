import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { BarChart3, IndianRupee, TrendingUp, UserCheck, Users } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import { useAppointments, useLeads, usePatients } from "@/lib/yhc-store";

export const Route = createFileRoute("/summary")({
  head: () => ({ meta: [{ title: "Day Summary — YHC Jaipur" }] }),
  component: SummaryPage,
});

function SummaryPage() {
  const patients = usePatients();
  const appts = useAppointments();
  const leads = useLeads();

  const s = useMemo(() => {
    const total = patients.length;
    const done = patients.filter((p) => p.status === "Done").length;
    const waiting = patients.filter((p) => p.status === "Waiting" || p.status === "In Consult").length;
    const payDue = patients.filter((p) => p.status === "Pay Due").length;
    const revenue = patients.reduce((sum, p) => sum + p.amountPaid, 0);
    const outstanding = patients.reduce((sum, p) => sum + p.amountDue, 0);
    const cash = patients.filter((p) => p.paymentMode === "Cash").reduce((s, p) => s + p.amountPaid, 0);
    const upi = patients.filter((p) => p.paymentMode === "UPI" || p.paymentMode === "QR").reduce((s, p) => s + p.amountPaid, 0);
    const card = patients.filter((p) => p.paymentMode === "Card").reduce((s, p) => s + p.amountPaid, 0);
    const other = revenue - cash - upi - card;

    // By branch
    const bajaj = patients.filter((p) => p.branch === "Bajaj Nagar").length;
    const jagat = patients.filter((p) => p.branch === "Jagatpura").length;

    // Sources
    const bySource = new Map<string, number>();
    patients.forEach((p) => bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1));
    const sources = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]);

    return {
      total, done, waiting, payDue, revenue, outstanding,
      cash, upi, card, other, bajaj, jagat, sources,
      apptConfirmed: appts.filter((a) => a.status === "Confirmed" || a.status === "Arrived").length,
      newLeads: leads.filter((l) => l.status === "HOT" || l.status === "Warm").length,
      converted: leads.filter((l) => l.status === "Converted").length,
    };
  }, [patients, appts, leads]);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <MobileShell title="Day Summary" subtitle={today} showBack>
      {/* Hero revenue */}
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="text-[11px] uppercase tracking-wider opacity-70">Today's Revenue</div>
        <div className="mt-1 text-3xl font-bold flex items-center">
          <IndianRupee className="h-6 w-6" /> {s.revenue.toLocaleString("en-IN")}
        </div>
        <div className="mt-2 text-[11px] opacity-80">
          Outstanding: ₹{s.outstanding.toLocaleString("en-IN")} • {s.payDue} pay-due
        </div>
      </div>

      {/* Patient stats */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <MiniStat icon={Users} label="Total" value={s.total} />
        <MiniStat icon={UserCheck} label="Done" value={s.done} tone="success" />
        <MiniStat icon={TrendingUp} label="Active" value={s.waiting} tone="accent" />
        <MiniStat icon={BarChart3} label="Due" value={s.payDue} tone="destructive" />
      </div>

      {/* Payment breakdown */}
      <SectionTitle>Payment Modes</SectionTitle>
      <div className="rounded-xl bg-surface border border-border p-3 space-y-2.5">
        <PayBar label="Cash" amount={s.cash} total={s.revenue || 1} color="bg-success" />
        <PayBar label="UPI / QR" amount={s.upi} total={s.revenue || 1} color="bg-primary" />
        <PayBar label="Card" amount={s.card} total={s.revenue || 1} color="bg-accent" />
        {s.other > 0 && <PayBar label="Other" amount={s.other} total={s.revenue || 1} color="bg-muted-foreground" />}
      </div>

      {/* Branch split */}
      <SectionTitle>By Branch</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bajaj Nagar</div>
          <div className="text-xl font-bold text-primary mt-1">{s.bajaj}</div>
          <div className="text-[10px] text-muted-foreground">patients</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Jagatpura</div>
          <div className="text-xl font-bold text-primary mt-1">{s.jagat}</div>
          <div className="text-[10px] text-muted-foreground">patients</div>
        </div>
      </div>

      {/* Appointments & leads */}
      <SectionTitle>Appointments & Leads</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <MiniStat icon={UserCheck} label="Confirmed" value={s.apptConfirmed} tone="success" />
        <MiniStat icon={Users} label="Active Leads" value={s.newLeads} tone="accent" />
        <MiniStat icon={TrendingUp} label="Converted" value={s.converted} tone="success" />
      </div>

      {/* Sources */}
      <SectionTitle>Top Sources</SectionTitle>
      <ul className="rounded-xl bg-surface border border-border divide-y divide-border overflow-hidden">
        {s.sources.map(([src, count]) => (
          <li key={src} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="text-foreground">{src}</span>
            <span className="font-bold text-primary">{count}</span>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-center text-[10px] text-muted-foreground">
        Auto-refreshed live from queue data.
      </p>
    </MobileShell>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-5 mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "success" | "destructive" | "accent";
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <Icon
        className={cn(
          "h-4 w-4 mx-auto",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
          tone === "accent" && "text-accent-foreground",
          !tone && "text-primary",
        )}
      />
      <div
        className={cn(
          "text-lg font-bold mt-0.5",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function PayBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = Math.round((amount / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-foreground font-medium">{label}</span>
        <span className="text-muted-foreground">₹{amount.toLocaleString("en-IN")} • {pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
