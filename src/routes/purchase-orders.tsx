import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, X, Package } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchPurchaseOrders, createPurchaseOrder, receivePoItem, branchLabel, BRANCH_KEYS, type PurchaseOrder } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({ meta: [{ title: "Purchase Orders — YHC" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["PHARMA", "RECP1", "RECP2", "OWNER"]} permKey="purchaseOrders">
      <PurchaseOrdersPage />
    </AuthGate>
  ),
});

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PARTIAL: "bg-accent/20 text-accent-foreground",
  COMPLETE: "bg-success/15 text-success",
  CANCELLED: "bg-destructive/10 text-destructive",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PARTIAL: "Partial",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

function CreatePOModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [branch, setBranch] = useState<string>(BRANCH_KEYS[0]);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState([{ item_name: "", quantity_requested: "", unit: "" }]);
  const [saving, setSaving] = useState(false);

  const addRow = () => setRows((r) => [...r, { item_name: "", quantity_requested: "", unit: "" }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: "item_name" | "quantity_requested" | "unit", value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  const submit = async () => {
    const items = rows
      .filter((r) => r.item_name.trim() && Number(r.quantity_requested) > 0)
      .map((r) => ({ item_name: r.item_name.trim(), quantity_requested: Number(r.quantity_requested), unit: r.unit.trim() || undefined }));
    if (items.length === 0) {
      toast.error("Kam se kam ek item ka naam aur quantity bharo");
      return;
    }
    setSaving(true);
    const res = await createPurchaseOrder(branch, notes.trim(), items);
    setSaving(false);
    if (!res.success) {
      toast.error("PO save nahi hua: " + res.error);
      return;
    }
    toast.success("Purchase order bhej diya — Owner ko dikh jaayega");
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-primary text-lg">New Purchase Order</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Branch</label>
            <div className="flex gap-1.5 mt-1">
              {BRANCH_KEYS.map((b) => (
                <button key={b} onClick={() => setBranch(b)} className={cn("flex-1 rounded-full px-3 py-2 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{branchLabel(b)}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Items</label>
            <div className="mt-1.5 space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={row.item_name}
                    onChange={(e) => updateRow(i, "item_name", e.target.value)}
                    placeholder="Item naam (e.g. Glass Bottle 30ml)"
                    className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm"
                  />
                  <input
                    value={row.quantity_requested}
                    onChange={(e) => updateRow(i, "quantity_requested", e.target.value)}
                    inputMode="numeric"
                    placeholder="Qty"
                    className="w-16 rounded-lg border border-border bg-surface px-2 py-2 text-sm"
                  />
                  <input
                    value={row.unit}
                    onChange={(e) => updateRow(i, "unit", e.target.value)}
                    placeholder="Unit"
                    className="w-16 rounded-lg border border-border bg-surface px-2 py-2 text-sm"
                  />
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(i)} aria-label="Item hatao" className="h-8 w-8 shrink-0 grid place-items-center rounded-full bg-destructive/10 text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-primary underline">
              <Plus className="h-3 w-3" /> Aur item add karo
            </button>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              placeholder="Vendor, urgency, koi bhi detail"
            />
          </div>
          <button onClick={submit} disabled={saving} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Bhej rahe hain…" : "Order Bhejo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiveItemsModal({ po, onClose, onUpdated }: { po: PurchaseOrder; onClose: () => void; onUpdated: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(po.items.map((it) => [it.id, String(it.quantity_received)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  const save = async (itemId: string) => {
    const qty = Number(values[itemId]);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error("Sahi quantity bharo");
      return;
    }
    setSavingId(itemId);
    const res = await receivePoItem(itemId, qty);
    setSavingId(null);
    if (!res.success) {
      toast.error("Update nahi hua: " + res.error);
      return;
    }
    toast.success("Received quantity update ho gayi");
    onUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-primary text-lg">Saman Aaya — Entry Karo</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2.5">
          {po.items.map((it) => (
            <div key={it.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-primary">{it.item_name}</div>
                <div className="text-[11px] text-muted-foreground">Order: {it.quantity_requested} {it.unit ?? ""}</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={values[it.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [it.id]: e.target.value }))}
                  inputMode="numeric"
                  className="flex-1 rounded-lg border border-input bg-background px-2.5 py-2 text-sm"
                  placeholder="Kitna aaya (total)"
                />
                <button
                  onClick={() => save(it.id)}
                  disabled={savingId === it.id}
                  className="rounded-lg bg-primary text-primary-foreground text-xs font-bold px-3 py-2 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground text-center mt-3">
          Total received quantity bharo (jitna abhi tak mila hai), sirf is delivery ka extra nahi.
        </p>
      </div>
    </div>
  );
}

function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["purchase-orders"], queryFn: fetchPurchaseOrders });
  const [showCreate, setShowCreate] = useState(false);
  const [receivingPo, setReceivingPo] = useState<PurchaseOrder | null>(null);
  const orders = data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["purchase-orders"] });

  return (
    <RoleShell
      wide
      showBack
      title="Purchase Orders"
      subtitle="Vendor se jo mangwana hai"
      right={
        <button onClick={() => setShowCreate(true)} className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5">
          + New
        </button>
      }
    >
      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} onCreated={invalidate} />}
      {receivingPo && (
        <ReceiveItemsModal
          po={orders.find((o) => o.id === receivingPo.id) ?? receivingPo}
          onClose={() => setReceivingPo(null)}
          onUpdated={invalidate}
        />
      )}
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : orders.length === 0 ? (
        <EmptyBlock label="Koi purchase order nahi hai abhi." />
      ) : (
        <ul className="space-y-2.5">
          {orders.map((po) => (
            <li key={po.id} className="rounded-2xl bg-surface border border-border p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {po.branch ? branchLabel(po.branch) : "—"} • {new Date(po.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </span>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase", STATUS_STYLE[po.status])}>
                  {STATUS_LABEL[po.status]}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {po.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between text-[12px]">
                    <span className="text-primary">{it.item_name}</span>
                    <span className={cn("font-semibold", it.quantity_received >= it.quantity_requested ? "text-success" : it.quantity_received > 0 ? "text-accent-foreground" : "text-muted-foreground")}>
                      {it.quantity_received} / {it.quantity_requested} {it.unit ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
              {po.notes && <div className="mt-2 text-[11px] text-muted-foreground">{po.notes}</div>}
              {po.status !== "COMPLETE" && po.status !== "CANCELLED" && (
                <button
                  onClick={() => setReceivingPo(po)}
                  className="mt-3 w-full rounded-lg bg-primary text-primary-foreground text-xs font-bold py-2"
                >
                  Saman Aaya — Update Karo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </RoleShell>
  );
}
