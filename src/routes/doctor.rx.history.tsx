import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/yhc/AuthGate";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { searchPatients, fetchPatientHistory } from "@/lib/db";

export const Route = createFileRoute("/doctor/rx/history")({
  head: () => ({ meta: [{ title: "Patient History — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["DOCTOR", "OWNER"]}>
      <HistoryPage />
    </AuthGate>
  ),
});

function HistoryPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  const search = useQuery({
    queryKey: ["rx-history-search", q],
    queryFn: () => searchPatients(q),
    enabled: q.trim().length >= 2,
  });

  const history = useQuery({
    queryKey: ["rx-history", selected?.id],
    queryFn: () => fetchPatientHistory(selected.id, 10),
    enabled: !!selected?.id,
  });

  const entries = history.data ?? [];

  return (
    <DoctorShell title="Patient History" subtitle={selected ? selected.name : "Search a patient"} nav="rx">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Patient</div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={selected ? `${selected.name} — ${selected.mobile}` : q}
            onChange={(e) => { setSelected(null); setQ(e.target.value); }}
            placeholder="Naam ya mobile se search karo"
            className="w-full rounded-xl bg-surface border border-border pl-9 pr-3 py-2.5 text-sm text-primary"
          />
        </div>
        {!selected && q.trim().length >= 2 && (
          <ul className="mt-2 rounded-xl border border-border bg-surface overflow-hidden">
            {(search.data ?? []).map((p: any) => (
              <li key={p.id}>
                <button
                  onClick={() => { setSelected(p); setQ(""); }}
                  className="w-full text-left px-3.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-accent/15 border-b border-border last:border-0"
                >
                  {p.name} — {p.mobile}
                </button>
              </li>
            ))}
            {search.data && search.data.length === 0 && (
              <li className="px-3.5 py-2.5 text-[12px] text-muted-foreground">Koi patient nahi mila</li>
            )}
          </ul>
        )}
      </div>

      {selected && (
        <ul className="mt-4 space-y-2.5">
          {history.isLoading && <li className="text-center text-sm text-muted-foreground py-6">Loading…</li>}
          {!history.isLoading && entries.length === 0 && (
            <li className="text-center text-sm text-muted-foreground py-10">No history recorded.</li>
          )}
          {entries.map((visit: any) => (
            <li key={visit.id} className="rounded-2xl bg-surface border border-border border-l-[4px] border-l-accent p-3.5">
              <div className="flex justify-between items-center">
                <span className="font-bold text-primary text-[14px]">{visit.visit_type ?? "Visit"}</span>
                <span className="text-[11px] text-muted-foreground">{visit.visit_date}</span>
              </div>
              {visit.doctor_notes && (
                <div className="text-[13px] text-muted-foreground mt-1">{visit.doctor_notes}</div>
              )}
              {(visit.prescriptions ?? []).length > 0 ? (
                <div className="mt-2 flex flex-col gap-1">
                  {visit.prescriptions.map((rx: any) => (
                    <div key={rx.id} className="text-[13px] text-primary">
                      • {rx.medicine_name} {rx.potency} — {rx.dose}, {rx.frequency} ({rx.duration_days} din)
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-muted-foreground mt-1">Is visit mein koi prescription nahi.</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </DoctorShell>
  );
}
