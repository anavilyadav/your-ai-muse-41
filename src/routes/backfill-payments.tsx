import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchBackfilledWithoutPayment, recordBackfillPayment, fetchPaymentModes, branchLabel, type BackfillPayRow } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/backfill-payments")({
  head: () => ({ meta: [{ title: "Purani entries — payment — YHC Jaipur" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="register">
      <BackfillPaymentsPage />
    </AuthGate>
  ),
});

// "Purani Tareekh Se Entry" used to save every back-dated patient with ₹0:
// the registration fee that was really paid on the day was never recorded
// (Dr. Yadav, 23 Oct 2026, e.g. Ananta Yadav's ₹3500 on 3 Oct). The entry
// form takes the fee properly now; this page fills it in for the ones
// already saved. Only a visit with no payment at all can be filled in.
const QUICK_AMOUNTS = [1000, 3500, 3700];

function Row({ row, modes, onSaved }: { row: BackfillPayRow; modes: { code: string; label: string }[]; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(modes[0]?.code ?? "CASH");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = Number(amount);
    if (!n || n <= 0) { toast.error("Amount bharo"); return; }
    setSaving(true);
    const res = await recordBackfillPayment(row.visit_id, n, mode);
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success(`${row.patient_name} — ₹${n.toLocaleString("en-IN")} darj ho gaya`);
    onSaved();
  };

  return (
    <li className="rounded-xl bg-surface border border-border p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm text-primary">{row.patient_name}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
          {row.card ?? row.patient_code ?? "—"}
        </span>
        {row.isNewPatient && <span className="text-[10px] font-semibold text-success">Naya patient</span>}
        <span className="text-[10px] text-muted-foreground">{branchLabel(row.branch)}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {QUICK_AMOUNTS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setAmount(String(q))}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-bold",
              amount === String(q) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-primary border-border",
            )}
          >
            ₹{q}
          </button>
        ))}
        <input
          inputMode="numeric"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          className="w-24 rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
        />
        <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
          {modes.length === 0 && <option value="CASH">Cash</option>}
          {modes.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-accent text-accent-foreground px-3.5 py-1.5 text-xs font-bold disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
      </div>
    </li>
  );
}

function BackfillPaymentsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["backfill-no-payment"], queryFn: fetchBackfilledWithoutPayment });
  const { data: modes } = useQuery({ queryKey: ["payment-modes-active"], queryFn: () => fetchPaymentModes(true) });
  const rows = data ?? [];
  const byDate = useMemo(() => {
    const m = new Map<string, BackfillPayRow[]>();
    for (const r of rows) (m.get(r.visit_date) ?? m.set(r.visit_date, []).get(r.visit_date)!).push(r);
    return Array.from(m);
  }, [rows]);

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ["backfill-no-payment"] });
    qc.invalidateQueries({ queryKey: ["day-summary"] });
  };

  return (
    <MobileShell title="Purani entries — payment" subtitle={`${rows.length} entry me payment darj nahi`} showBack>
      <div className="rounded-xl bg-accent/20 border border-accent/40 p-3 text-[12px] text-primary mb-3">
        Purani tareekh se jo patient bhare gaye, unka registration payment app me save nahi hua tha. Jisne jo diya wo yahan daalo —
        paisa usi din ki collection me judega. Jinhone kuch nahi diya unhe chhod do.
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Sab purani entries me payment darj hai." />
      ) : (
        <ul className="space-y-2 pb-6">
          {byDate.map(([date, list]) => (
            <Fragment key={date}>
              <li className="pt-2 first:pt-0">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground px-1">
                  {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} • {list.length} entry
                </div>
              </li>
              {list.map((r) => <Row key={r.visit_id} row={r} modes={modes ?? []} onSaved={onSaved} />)}
            </Fragment>
          ))}
        </ul>
      )}
    </MobileShell>
  );
}
