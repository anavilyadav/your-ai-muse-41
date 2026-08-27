import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchPaymentModes, addPaymentMode, setPaymentModeActive, deletePaymentMode } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/payment-modes")({
  head: () => ({ meta: [{ title: "Payment Modes — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <PaymentModesPage />
    </AuthGate>
  ),
});

function AddModeModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!code.trim() || !label.trim()) { toast.error("Code aur label dono chahiye"); return; }
    setSaving(true);
    const res = await addPaymentMode(code, label);
    setSaving(false);
    if (!res.success) { toast.error("Add nahi hua: " + res.error); return; }
    toast.success(label.trim() + " add ho gaya");
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Naya Payment Mode</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Paytm" className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. PAYTM" className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm uppercase" />
          </div>
          <p className="text-[11px] text-muted-foreground">Ye Payment screen aur reports dono mein turant dikhega.</p>
          <button onClick={save} disabled={saving} className="mt-2 w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold disabled:opacity-60">
            {saving ? "Saving…" : "Add karo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentModesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["payment-modes-all"], queryFn: () => fetchPaymentModes(false) });
  const modes = data ?? [];
  const [showAdd, setShowAdd] = useState(false);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["payment-modes-all"] });
    qc.invalidateQueries({ queryKey: ["payment-modes"] });
  };

  const toggleActive = async (id: string, next: boolean) => {
    const res = await setPaymentModeActive(id, next);
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    reload();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Ye payment mode delete karein?")) return;
    const res = await deletePaymentMode(id);
    if (!res.success) { toast.error("Delete nahi hua: " + res.error); return; }
    toast.success("Delete ho gaya");
    reload();
  };

  return (
    <RoleShell wide title="Payment Modes" subtitle="Cash/UPI/Card + apne khud ke modes" showBack>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">Payment screen aur reports dono ismein use hote hain.</p>
        <button
          onClick={() => setShowAdd(true)}
          className="shrink-0 flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-bold"
        >
          <Plus className="h-3.5 w-3.5" /> Naya
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : modes.length === 0 ? (
        <EmptyBlock label="Koi payment mode nahi mila." />
      ) : (
        <div className="space-y-1.5">
          {modes.map((m) => (
            <div key={m.id} className={cn("flex items-center justify-between rounded-xl border border-border p-3", m.is_active ? "bg-surface" : "bg-muted/50 opacity-60")}>
              <div className="text-sm min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold truncate">{m.label}</span>
                  {m.is_system && (
                    <span className="shrink-0 rounded-full bg-muted text-muted-foreground text-[9px] font-bold px-1.5 py-0.5 uppercase">System</span>
                  )}
                </div>
                <span className="text-muted-foreground text-[11px]">{m.code}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => toggleActive(m.id, !m.is_active)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-bold border",
                    m.is_active ? "bg-success/15 border-success/40 text-success" : "bg-surface border-border text-muted-foreground",
                  )}
                >
                  {m.is_active ? "Active" : "Inactive"}
                </button>
                {!m.is_system && (
                  <button onClick={() => remove(m.id)} className="h-7 w-7 grid place-items-center rounded-full bg-destructive/15 text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddModeModal onClose={() => setShowAdd(false)} onAdded={reload} />}
    </RoleShell>
  );
}
