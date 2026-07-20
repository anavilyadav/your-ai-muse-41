import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { Eye, EyeOff } from "lucide-react";
import { useDoctorSession } from "@/lib/yhc-doctor";

export const Route = createFileRoute("/doctor/rx/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const session = useDoctorSession();
  const [showRev, setShowRev] = useState(false);
  const conditions: [string, number][] = [
    ["Joint pain", 24], ["Skin issues", 18], ["Anxiety", 15], ["Migraine", 12], ["PCOS", 9],
  ];
  const max = 24;

  return (
    <DoctorShell title="Doctor Dashboard" subtitle={session?.name} nav="rx">
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Today</div>
      <div className="grid grid-cols-4 gap-2 mt-2">
        {[
          { v: 7, l: "Seen" },
          { v: 2, l: "New cases" },
          { v: 5, l: "Follow-ups" },
          { v: "6m", l: "Avg time" },
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
          <div className="text-xl font-extrabold text-primary">142</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Total patients</div>
        </div>
        <button
          onClick={() => setShowRev((v) => !v)}
          className="rounded-xl bg-surface border border-border px-2 py-3 text-center"
        >
          <div className={"text-xl font-extrabold text-accent-foreground " + (showRev ? "" : "blur-sm")}>₹1.2L</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5 inline-flex items-center gap-1 justify-center">
            Revenue {showRev ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </div>
        </button>
      </div>

      <div className="mt-5 rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Top conditions — this month</div>
        {conditions.map(([name, val]) => (
          <div key={name} className="mb-2.5">
            <div className="flex justify-between text-[13px] text-primary mb-1">
              <span>{name}</span><span className="font-bold">{val}</span>
            </div>
            <div className="h-2 rounded-full bg-accent/25 overflow-hidden">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(val / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Outcome summary</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center"><div className="text-xl font-extrabold text-success">68%</div><div className="text-[11px] text-muted-foreground">Improved</div></div>
          <div className="text-center"><div className="text-xl font-extrabold text-accent-foreground">24%</div><div className="text-[11px] text-muted-foreground">Stable</div></div>
          <div className="text-center"><div className="text-xl font-extrabold text-destructive">8%</div><div className="text-[11px] text-muted-foreground">Worse</div></div>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-accent/25 border border-accent/40 p-3.5 flex justify-between items-center">
        <span className="font-bold text-primary text-sm">Cases awaiting Rx</span>
        <span className="rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-2.5 py-1">4 pending</span>
      </div>
    </DoctorShell>
  );
}
