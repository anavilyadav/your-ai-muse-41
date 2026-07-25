import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3, IndianRupee, TrendingUp, UserCheck, Users } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import { fetchDaySummary } from "@/lib/db";

export const Route = createFileRoute("/summary")({
  head: () => ({ meta: [{ title: "Day Summary — YHC Jaipur" }] }),
  component: SummaryPage,
});

function SummaryPage() {
  const [s, setS] = useState<Awaited<ReturnType<typeof fetchDaySummary>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchDaySummary();
      if (!cancelled) {
        setS(r);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  if (loading || !s) {
    return (
      <MobileShell title="Day Summary" subtitle={today} showBack>
        <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
      </MobileShell>
    );
  }

  return (
    <MobileShell title="Day Summary" subtitle={today} showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="text-[11px] uppercase tracking-wider opacity-70">Today's Revenue</div>
        <div className="mt-1 text-3xl font-bold flex items-center">
          <IndianRupee className="h-6 w-6" /> {s.revenue.toLocaleString("en-IN")}
        </div>
        <div className="mt-2 text-[11px] opacity-80">
          Outstanding: ₹{s.outstanding.toLocaleString("en-IN")} • {s.pendingPayments} pay-due
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <MiniStat icon={Users} label="Total" value={s.totalPatients} />
        <MiniStat icon={UserCheck} label="Done" value={s.done} tone="success" />
        <MiniStat icon={TrendingUp} label="Active" value={s.waiting} tone="accent" />
        <MiniStat icon={BarChart3} label="Due" value={s.pendingPayments} tone="destructive" />
      </div>

      <SectionTitle>New vs Follow-up</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">New</div>
          <div className="text-xl font-bold text-primary mt-1">{s.newPatients}</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Follow-up</div>
          <div className="text-xl font-bold text-primary mt-1">{s.followupPatients}</div>
        </div>
      </div>

      <SectionTitle>Payment Modes</SectionTitle>
      <div className="rounded-xl bg-surface border border-border p-3 space-y-2.5">
        <PayBar label="Cash" amount={s.cash} total={s.revenue || 1} color="bg-success" />
        <PayBar label="UPI / QR" amount={s.upi} total={s.revenue || 1} color="bg-primary" />
        <PayBar label="Card" amount={s.card} total={s.revenue || 1} color="bg-accent" />
      </div>

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

      <p className="mt-5 text-center text-[10px] text-muted-foreground">
        Live from today's visits & payments.
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
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "success" | "destructive" | "accent";
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <Icon className={cn("h-4 w-4 mx-auto",
        tone === "success" && "text-success",
        tone === "destructive" && "text-destructive",
        tone === "accent" && "text-accent-foreground",
        !tone && "text-primary",
      )} />
      <div className={cn("text-lg font-bold mt-0.5",
        tone === "success" && "text-success",
        tone === "destructive" && "text-destructive",
      )}>{value}</div>
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
