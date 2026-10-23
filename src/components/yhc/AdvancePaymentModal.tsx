import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { recordAdvancePayment, fetchPaymentModes } from "@/lib/db";
import { cn } from "@/lib/utils";

const QUICK_AMOUNTS = [1000, 2500, 3500, 3700];

// Advance payment (Dr. Yadav, 23 Oct 2026): the patient has already paid and
// is now waiting for the consultation. The money goes into the collection
// straight away; the visit stays exactly where it is, and the Pay screen
// deducts the advance from the final bill.
export function AdvancePaymentModal({
  visitId,
  patientName,
  onClose,
  onSaved,
}: {
  visitId: string;
  patientName: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { data: modes } = useQuery({ queryKey: ["payment-modes-active"], queryFn: () => fetchPaymentModes(true) });
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const modeCode = mode || modes?.[0]?.code || "CASH";

  const save = async () => {
    const n = Number(amount);
    if (!n || n <= 0) { toast.error("Amount bharo"); return; }
    setSaving(true);
    const res = await recordAdvancePayment(visitId, n, modeCode, note.trim() || undefined);
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success(`${patientName} — ₹${n.toLocaleString("en-IN")} advance darj ho gaya`);
    qc.invalidateQueries({ queryKey: ["advance-by-visit"] });
    qc.invalidateQueries({ queryKey: ["day-summary"] });
    qc.invalidateQueries({ queryKey: ["visit"] });
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[clamp(430px,90vw,640px)] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">Advance Payment</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
          {patientName} ne consultation se pehle paisa de diya hai. Paisa aaj ki collection me judega, visit waise hi pending rahegi,
          aur final payment me ye advance kat jayega.
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount(String(q))}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-bold",
                amount === String(q) ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
              )}
            >
              ₹{q}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            inputMode="numeric"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            className="flex-1 min-w-0 rounded-xl border border-input bg-surface px-3 py-2.5 text-sm"
          />
          <select value={modeCode} onChange={(e) => setMode(e.target.value)} className="rounded-xl border border-input bg-surface px-2 py-2.5 text-sm">
            {(modes ?? []).length === 0 && <option value="CASH">Cash</option>}
            {(modes ?? []).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional) — jaise online consultation ka advance"
          className="mt-2 w-full rounded-xl border border-input bg-surface px-3 py-2.5 text-sm"
        />
        <button onClick={save} disabled={saving} className="mt-3 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Advance darj karo"}
        </button>
      </div>
    </div>
  );
}
