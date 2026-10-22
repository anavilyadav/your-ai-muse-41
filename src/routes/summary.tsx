import { createFileRoute } from "@tanstack/react-router";
import { AuthGate, ErrorBlock } from "@/components/yhc/AuthGate";
import { useEffect, useState } from "react";
import { BarChart3, IndianRupee, TrendingUp, UserCheck, Users, PhoneCall, Clock } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import { fetchDaySummary, fetchBackfilledEntries, type BackfilledEntry } from "@/lib/db";
import { today as todayIso } from "@/lib/supabase";

export const Route = createFileRoute("/summary")({
  head: () => ({ meta: [{ title: "Day Summary — YHC Jaipur" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="summary">
      <SummaryPage />
    </AuthGate>
  ),
});

// Cycles for however many payment modes exist (was 3 hardcoded colors for
// fixed Cash/UPI/Card bars — modes are Owner-managed now, so this list
// just needs to not run out, not match any specific mode).
const PAY_BAR_COLORS = ["bg-success", "bg-primary", "bg-accent", "bg-destructive", "bg-muted-foreground"];

function SummaryPage() {
  const [s, setS] = useState<Awaited<ReturnType<typeof fetchDaySummary>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [date, setDate] = useState(() => todayIso());
  const [backfilled, setBackfilled] = useState<BackfilledEntry[]>([]);
  const isToday = date === todayIso();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [r, b] = await Promise.all([fetchDaySummary(undefined, date), fetchBackfilledEntries(date)]);
        if (!cancelled) { setS(r); setBackfilled(b); }
      } catch (e) {
        // fetchDaySummary now throws on a real DB error instead of
        // silently returning ₹0/0-everything — this catch is what turns
        // that into a visible retry instead of an unhandled rejection.
        if (!cancelled) setLoadError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryTick, date]);

  const today = new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // Any past day can be opened — e.g. to check visits Reception back-
  // entered with "Purani Tareekh Se Entry".
  const datePicker = (
    <div className="mb-3 flex items-center gap-2">
      <input
        type="date"
        value={date}
        max={todayIso()}
        onChange={(e) => e.target.value && setDate(e.target.value)}
        className="flex-1 rounded-lg bg-surface border border-input px-3 py-2 text-sm"
        aria-label="Kis din ki summary dekhni hai"
      />
      {!isToday && (
        <button onClick={() => setDate(todayIso())} className="rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-primary">
          Aaj
        </button>
      )}
    </div>
  );

  if (loading) {
    return (
      <MobileShell title="Day Summary" subtitle={today} showBack>
        {datePicker}
        <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
      </MobileShell>
    );
  }

  if (loadError || !s) {
    return (
      <MobileShell title="Day Summary" subtitle={today} showBack>
        {datePicker}
        <ErrorBlock error={loadError} onRetry={() => setRetryTick((t) => t + 1)} />
      </MobileShell>
    );
  }

  return (
    <MobileShell title="Day Summary" subtitle={today} showBack>
      {datePicker}
      {backfilled.length > 0 && <BackfilledList entries={backfilled} isToday={isToday} />}
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="text-[11px] uppercase tracking-wider opacity-70">{isToday ? "Today's Revenue" : "Is din ka Revenue"}</div>
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

      {/* Walk-in/Online split added (25 Sep 2026, Dr. Yadav: "token count ko
          detail me thik karo sab include karke") — the plain New/Follow-up
          totals stay as headline numbers, each now broken down by channel
          right underneath. */}
      <SectionTitle>New vs Follow-up</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">New</div>
          <div className="text-xl font-bold text-primary mt-1">{s.newPatients}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{s.newWalkIn} Walk-in · {s.newOnline} Online</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Follow-up</div>
          <div className="text-xl font-bold text-primary mt-1">{s.followupPatients}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{s.followupWalkIn} Walk-in · {s.followupOnline} Online</div>
        </div>
      </div>

      <SectionTitle>Complaints &amp; Online Follow-up</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <PhoneCall className="h-4 w-4 mx-auto text-destructive" />
          <div className="text-xl font-bold text-primary mt-1">{s.complaintsLoggedToday}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Aaj Log Hui{s.complaintsOpenTotal > 0 ? ` · ${s.complaintsOpenTotal} pending` : ""}</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <Clock className="h-4 w-4 mx-auto text-accent-foreground" />
          <div className="text-xl font-bold text-primary mt-1">{s.onlineFollowupAwaitingPayment}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment Baaki (rough){s.onlineFollowupConfirmedToday > 0 ? ` · ${s.onlineFollowupConfirmedToday} confirmed aaj` : ""}</div>
        </div>
      </div>

      <SectionTitle>Payment Modes</SectionTitle>
      <div className="rounded-xl bg-surface border border-border p-3 space-y-2.5">
        {s.byMode.map((m, i) => (
          <PayBar key={m.mode} label={m.label} amount={m.amount} total={s.revenue || 1} color={PAY_BAR_COLORS[i % PAY_BAR_COLORS.length]} />
        ))}
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

// Visits typed in on this day but dated earlier ("Purani Tareekh Se
// Entry") — they count on their own date, so without this list nobody
// could see what was back-entered today.
function BackfilledList({ entries, isToday }: { entries: BackfilledEntry[]; isToday: boolean }) {
  const [open, setOpen] = useState(false);
  const dupes = entries.filter((e) => e.alreadyExisted).length;
  const byDate = new Map<string, BackfilledEntry[]>();
  for (const e of entries) byDate.set(e.visit_date, [...(byDate.get(e.visit_date) ?? []), e]);
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return (
    <div className="mb-3 rounded-2xl border border-accent/50 bg-accent/10 p-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="text-[12px] font-bold text-primary">
          {isToday ? "Aaj" : "Is din"} {entries.length} purani entries daali gayi {open ? "▾" : "▸"}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {Array.from(byDate.entries()).map(([d, list]) => `${fmt(d)}: ${list.length}`).join(" • ")}
          {" — ye apni tareekh ki summary me gini jaati hain, is din ki me nahi."}
        </div>
        {dupes > 0 && (
          <div className="text-[11px] font-semibold text-destructive mt-1">
            ⚠️ {dupes} entries ki visit app me pehle se thi (dobara daal di gayi)
          </div>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {Array.from(byDate.entries()).map(([d, list]) => (
            <div key={d}>
              <div className="text-[11px] font-bold text-muted-foreground">{fmt(d)} ki visit</div>
              <ul className="mt-0.5 space-y-0.5">
                {list.map((e) => (
                  <li key={e.id} className="text-[12px] flex items-center justify-between gap-2">
                    <span className="truncate">{e.patient_name}</span>
                    {e.alreadyExisted && <span className="shrink-0 text-[10px] font-semibold text-destructive">pehle se thi</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
