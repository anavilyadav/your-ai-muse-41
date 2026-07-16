import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { formatWait, usePatients, type PatientStatus } from "@/lib/yhc-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today's Queue — Yadav Homeo Clinic, Jaipur" },
      { name: "description", content: "Reception queue for Yadav Homeo Clinic Jaipur." },
    ],
  }),
  component: QueuePage,
});

const flowSteps = ["RECP1", "Case Dr", "Wait", "Rx Doctor", "Pharmacy", "Payment"];
const filters = ["All", "Waiting", "Consultation", "Done", "New Patients"] as const;
type Filter = (typeof filters)[number];

const statusStyles: Record<PatientStatus, string> = {
  Waiting: "bg-accent/25 text-accent-foreground border-accent/60",
  "In Consult": "bg-success/20 text-success border-success/50",
  Pharmacy: "bg-accent/25 text-accent-foreground border-accent/60",
  "Pay Due": "bg-destructive/15 text-destructive border-destructive/40",
  Done: "bg-muted text-muted-foreground border-border",
};

function QueuePage() {
  const patients = usePatients();
  const [filter, setFilter] = useState<Filter>("All");

  const stats = useMemo(() => {
    const waiting = patients.filter((p) => p.status === "Waiting").length;
    const done = patients.filter((p) => p.status === "Done").length;
    const revenue = patients.reduce((s, p) => s + p.amountPaid, 0);
    return { total: patients.length, waiting, done, revenue };
  }, [patients]);

  const filtered = patients.filter((p) => {
    if (filter === "All") return true;
    if (filter === "Waiting") return p.status === "Waiting";
    if (filter === "Consultation") return p.status === "In Consult";
    if (filter === "Done") return p.status === "Done";
    if (filter === "New Patients") return Number(p.id.replace("YHC-", "")) >= 1006;
    return true;
  });

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });

  return (
    <MobileShell
      title="Yadav Homeo Clinic"
      subtitle={`Jaipur • ${today}`}
      right={
        <Link
          to="/register"
          className="h-9 px-3 rounded-full bg-accent text-accent-foreground text-xs font-bold inline-flex items-center gap-1 shadow-sm"
        >
          <Plus className="h-4 w-4" /> New
        </Link>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Total", value: stats.total, tone: "primary" },
          { label: "Waiting", value: stats.waiting, tone: "accent" },
          { label: "Done", value: stats.done, tone: "success" },
          { label: "Revenue", value: `₹${stats.revenue}`, tone: "primary" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-surface border border-border px-2 py-2.5 text-center"
          >
            <div
              className={cn(
                "text-base font-bold leading-tight",
                s.tone === "success" && "text-success",
                s.tone === "accent" && "text-accent-foreground",
                s.tone === "primary" && "text-primary",
              )}
            >
              {s.value}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Flow */}
      <div className="mt-4 rounded-xl bg-primary/5 border border-primary/10 p-2.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
          Patient Flow
        </div>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {flowSteps.map((s, i) => (
            <div key={s} className="flex items-center gap-1 shrink-0">
              <span className="px-2 py-1 rounded-md bg-surface border border-border text-[11px] font-semibold text-primary">
                {s}
              </span>
              {i < flowSteps.length - 1 && (
                <span className="text-muted-foreground text-xs">→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {filters.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-surface text-foreground border-border",
              )}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* List */}
      <ul className="mt-3 space-y-2">
        {filtered.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-10">
            No patients in this filter.
          </li>
        )}
        {filtered.map((p) => (
          <li
            key={p.id}
            className="rounded-xl bg-surface border border-border p-3 flex items-center gap-3 shadow-sm"
          >
            <div className="shrink-0 h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center">
              <div className="text-[9px] uppercase opacity-70 leading-none">Token</div>
              <div className="text-sm font-bold leading-tight">{p.token}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold text-sm text-primary">{p.name}</p>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatWait(Date.now() - p.arrivedAt)}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{p.chiefComplaint}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground">{p.branch}</span>
                <span
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                    statusStyles[p.status],
                  )}
                >
                  {p.status}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </MobileShell>
  );
}
