import { createFileRoute } from "@tanstack/react-router";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { Eye, EyeOff } from "lucide-react";
import { useDoctorSession } from "@/lib/yhc-doctor";
import { fetchDoctorDashboard } from "@/lib/db";

export const Route = createFileRoute("/doctor/rx/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["DOCTOR", "OWNER"]} permKey="rxDashboard">
      <DashboardPage />
    </AuthGate>
  ),
});

function formatRevenue(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${n}`;
}

function DashboardPage() {
  const session = useDoctorSession();
  const [showRev, setShowRev] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: fetchDoctorDashboard,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <DoctorShell title="Doctor Dashboard" subtitle={session?.name} nav="rx">
        <LoadingBlock />
      </DoctorShell>
    );
  }

  const topMax = data.topComplaints[0]?.[1] ?? 1;

  return (
    <DoctorShell title="Doctor Dashboard" subtitle={session?.name} nav="rx">
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Today</div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {[
          { v: data.todaySeen, l: "Seen" },
          { v: data.todayNew, l: "New patients" },
          { v: data.todayFollowupsDone, l: "Follow-ups done" },
        ].map((s) => (
          <div key={s.l} className="rounded-xl bg-surface border border-border px-1.5 py-2.5 text-center">
            <div className="text-base font-bold text-primary leading-tight">{s.v}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mt-5">This month</div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="rounded-xl bg-surface border border-border px-2 py-3 text-center">
          <div className="text-xl font-extrabold text-primary">{data.monthPatients}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Unique patients</div>
        </div>
        <button
          onClick={() => setShowRev((v) => !v)}
          className="rounded-xl bg-surface border border-border px-2 py-3 text-center"
        >
          <div className={"text-xl font-extrabold text-accent-foreground " + (showRev ? "" : "blur-sm")}>
            {formatRevenue(data.monthRevenue)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5 inline-flex items-center gap-1 justify-center">
            Revenue {showRev ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </div>
        </button>
      </div>

      <div className="mt-5 rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Top complaints — this month
        </div>
        {data.topComplaints.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-2">Is mahine ka data abhi tak nahi.</div>
        ) : (
          data.topComplaints.map(([name, val]) => (
            <div key={name} className="mb-2.5">
              <div className="flex justify-between text-[13px] text-primary mb-1">
                <span className="truncate pr-2">{name}</span>
                <span className="font-bold">{val}</span>
              </div>
              <div className="h-2 rounded-full bg-accent/25 overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(val / topMax) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 rounded-xl bg-accent/25 border border-accent/40 p-3.5 flex justify-between items-center">
        <span className="font-bold text-primary text-sm">Cases awaiting Rx</span>
        <span className="rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-2.5 py-1">
          {data.awaitingRx} pending
        </span>
      </div>
    </DoctorShell>
  );
}
