import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate } from "@/components/yhc/AuthGate";
import { LogInteractionModal } from "@/components/yhc/LogInteractionModal";
import { searchPatients } from "@/lib/db";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

// Reception asked directly (22 Sep 2026) for a quick way to log a
// complaint/support call without first hunting for the patient's full
// profile — the only existing entry point for LogInteractionModal was
// buried inside Patient Profile. This is the same search → pick → log
// pattern as delivery.tsx's NewDeliveryModal, just reused as its own
// screen off the Reception dashboard.
export const Route = createFileRoute("/complaint-call")({
  head: () => ({ meta: [{ title: "Complaint / Support Call — YHC Jaipur" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="queue">
      <ComplaintCallPage />
    </AuthGate>
  ),
});

function ComplaintCallPage() {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [selected, setSelected] = useState<any | null>(null);
  const [showLog, setShowLog] = useState(false);

  const { data: results, isError, error, refetch } = useQuery({
    queryKey: ["complaint-call-patient-search", debouncedQ],
    queryFn: () => searchPatients(debouncedQ),
    enabled: !selected && debouncedQ.trim().length >= 2,
  });

  return (
    <MobileShell title="Complaint / Support Call" subtitle="Reception" showBack>
      <div className="rounded-xl bg-primary/10 text-primary text-[12px] px-3 py-2.5 mb-3">
        Patient dhoondo, phir jo baat hui uska note likho — type "Complaint" chuno agar patient ne koi problem bataayi hai.
      </div>

      {!selected ? (
        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase">Patient</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Naam ya mobile se search karo"
            className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            autoFocus
          />
          {results && results.length > 0 && (
            <ul className="mt-2 rounded-xl border border-border bg-surface overflow-hidden">
              {results.map((p: any) => (
                <li key={p.id}>
                  <button
                    onClick={() => { setSelected(p); setShowLog(true); }}
                    className="w-full text-left px-3.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-accent/15 border-b border-border last:border-0"
                  >
                    {p.name} — {p.mobile} {p.patient_code && <span className="text-muted-foreground">({p.patient_code})</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {isError && debouncedQ.trim().length >= 2 && (
            <div className="mt-2 rounded-xl bg-destructive/10 border border-destructive/30 p-2.5">
              <p className="text-xs text-destructive font-semibold">Search fail hui: {(error as any)?.message ?? "unknown error"}</p>
              <button onClick={() => refetch()} className="mt-1 text-[11px] font-bold text-primary underline">Dobara try karo</button>
            </div>
          )}
          {!isError && results && results.length === 0 && debouncedQ.trim().length >= 2 && (
            <p className="mt-2 text-xs text-muted-foreground">Koi patient nahi mila.</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-accent/15 border border-accent/40 p-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-primary">{selected.name}</div>
            <div className="text-[11px] text-muted-foreground">{selected.mobile} • {selected.patient_code}</div>
          </div>
          <button onClick={() => { setSelected(null); setShowLog(false); }} className="text-[11px] font-semibold text-primary underline">Badlo</button>
        </div>
      )}

      {selected && !showLog && (
        <button
          onClick={() => setShowLog(true)}
          className="mt-3 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm"
        >
          Note likho
        </button>
      )}

      {selected && showLog && (
        <LogInteractionModal
          patientId={selected.id}
          defaultType="COMPLAINT"
          onClose={() => setShowLog(false)}
          onLogged={() => { setSelected(null); setQ(""); }}
        />
      )}
    </MobileShell>
  );
}
