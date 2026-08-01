import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchPendingCases, fetchCaseFunnelStats, branchLabel, type PendingCase } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/case-tracking")({
  head: () => ({ meta: [{ title: "Case Tracking — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER", "RECP1", "RECP2"]} permKey="caseTracking">
      <CaseTrackingPage />
    </AuthGate>
  ),
});

function daysAgo(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function StatBlock({ label, total, discussed }: { label: string; total: number; discussed: number }) {
  const pending = total - discussed;
  return (
    <div className="rounded-xl bg-surface border border-border p-3">
      <div className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-black text-primary">{total}</span>
        <span className="text-[11px] text-muted-foreground">registered</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px]">
        <span className="text-success font-semibold">{discussed} discussed</span>
        {pending > 0 && <span className="text-destructive font-semibold">{pending} pending</span>}
      </div>
    </div>
  );
}

function CaseTrackingPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["case-funnel-stats"],
    queryFn: fetchCaseFunnelStats,
  });
  const { data: pending, isLoading: pendingLoading } = useQuery({
    queryKey: ["pending-cases"],
    queryFn: fetchPendingCases,
  });

  const list = pending ?? [];
  const onlineList = list.filter((v) => v.visit_type === "ONLINE");
  const walkInList = list.filter((v) => v.visit_type !== "ONLINE");

  return (
    <RoleShell wide title="Case Tracking" subtitle="Registered vs discussed — koi bhi case gayab nahi hoga" showBack>
      {statsLoading ? (
        <LoadingBlock />
      ) : stats ? (
        <div className="grid grid-cols-2 gap-2">
          <StatBlock label="Today" total={stats.today.total} discussed={stats.today.discussed} />
          <StatBlock label="This Week" total={stats.week.total} discussed={stats.week.discussed} />
          <StatBlock label="This Month" total={stats.month.total} discussed={stats.month.discussed} />
          <StatBlock label="This Year" total={stats.year.total} discussed={stats.year.discussed} />
        </div>
      ) : (
        <EmptyBlock label="Stats load nahi hue." />
      )}

      {stats && (
        <div className="mt-3 rounded-xl bg-primary/5 border border-primary/20 p-3">
          <div className="text-[11px] font-semibold text-primary mb-1">Online cases (upfront-paid)</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Aaj: {stats.today.online_discussed}/{stats.today.online_total} discussed</span>
            <span>Week: {stats.week.online_discussed}/{stats.week.online_total} discussed</span>
            <span>Month: {stats.month.online_discussed}/{stats.month.online_total} discussed</span>
            <span>Year: {stats.year.online_discussed}/{stats.year.online_total} discussed</span>
          </div>
        </div>
      )}

      <div className="mt-5 mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-primary">Pending Discussion ({list.length})</h3>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Har wo case jiska Rx abhi tak nahi likha gaya — chahe kitne bhi din se pending ho, yahan se kabhi gayab nahi hoga.
      </p>

      {pendingLoading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyBlock label="Koi bhi case pending nahi hai — sab discuss ho chuke hain." />
      ) : (
        <div className="space-y-4">
          {onlineList.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-destructive mb-1.5">🔴 Online — {onlineList.length}</div>
              <CaseList cases={onlineList} />
            </div>
          )}
          {walkInList.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-muted-foreground mb-1.5">Walk-in — {walkInList.length}</div>
              <CaseList cases={walkInList} />
            </div>
          )}
        </div>
      )}
    </RoleShell>
  );
}

function CaseList({ cases }: { cases: PendingCase[] }) {
  return (
    <div className="space-y-2">
      {cases.map((v) => {
        const days = daysAgo(v.created_at);
        return (
          <div key={v.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold text-primary truncate">{v.patient?.name ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {v.patient?.patient_code} • {v.patient?.mobile} • {branchLabel(v.branch)}
                </div>
              </div>
              <div
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold",
                  days >= 5 ? "bg-destructive/15 text-destructive" : days >= 2 ? "bg-accent/20 text-accent-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {days === 0 ? "Aaj" : `${days} din se`}
              </div>
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              Stage: <span className="font-semibold">{v.visit_status.replace("_", " ")}</span> • Token {v.token_number ?? "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
