import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { RX_HISTORY, RX_QUEUE } from "@/lib/yhc-doctor";
import { toast } from "sonner";

export const Route = createFileRoute("/doctor/rx/history")({
  head: () => ({ meta: [{ title: "Patient History — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const [selected, setSelected] = useState<string>("T-01");
  const [range, setRange] = useState<"all" | "3m" | "6m">("all");
  const patient = RX_QUEUE.find((p) => p.token === selected);
  const entries = RX_HISTORY[selected] ?? [];

  return (
    <DoctorShell title="Patient History" subtitle={patient ? `${patient.name} • ${selected}` : selected} nav="rx">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Patient</div>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full rounded-xl bg-surface border border-border px-3 py-2.5 text-sm text-primary"
        >
          {RX_QUEUE.map((p) => (
            <option key={p.token} value={p.token}>{p.token} — {p.name}</option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
        {[
          { k: "all", l: "All" },
          { k: "3m", l: "Last 3 months" },
          { k: "6m", l: "Last 6 months" },
        ].map((f) => {
          const active = range === (f.k as typeof range);
          return (
            <button
              key={f.k}
              onClick={() => setRange(f.k as typeof range)}
              className={
                "shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border transition " +
                (active ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border")
              }
            >
              {f.l}
            </button>
          );
        })}
      </div>

      <ul className="mt-4 space-y-2.5">
        {entries.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-10">No history recorded.</li>
        )}
        {entries.map((h, i) => (
          <li key={i} className="rounded-2xl bg-surface border border-border border-l-[4px] border-l-accent p-3.5">
            <div className="flex justify-between items-center">
              <span className="font-bold text-primary text-[15px]">{h.med} {h.potency}</span>
              <span className="text-[11px] text-muted-foreground">{h.date}</span>
            </div>
            <div className="text-[13px] text-success font-semibold mt-1">{h.outcome}</div>
            <div className="text-[13px] text-muted-foreground mt-0.5">{h.notes}</div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => toast("Prescription photo")}
                className="rounded-lg bg-accent/20 text-primary text-[11px] font-semibold px-2.5 py-1"
              >
                📄 Rx photo
              </button>
              <button
                onClick={() => toast("Reports (separate category)")}
                className="rounded-lg bg-accent/20 text-primary text-[11px] font-semibold px-2.5 py-1"
              >
                📋 Reports
              </button>
            </div>
          </li>
        ))}
      </ul>
    </DoctorShell>
  );
}
