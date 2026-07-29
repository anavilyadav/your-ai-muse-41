import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { RoleShell, Stat } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { PHARMACY_NAV } from "./pharmacy.index";
import { fetchInventory, fetchInventorySearch, addStockEntry, BRANCH_LABELS } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export const Route = createFileRoute("/pharmacy/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Pharmacy" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["PHARMA", "OWNER"]}>
      <InventoryPage />
    </AuthGate>
  ),
});

const BRANCHES = BRANCH_LABELS;
const COMMON_POTENCIES = ["6", "30", "200", "1M", "10M", "CM", "Q"];

function isLow(row: any): boolean {
  const stock = Number(row.stock_drams ?? row.stock ?? 0);
  const low = Number(row.reorder_level ?? row.low ?? 20);
  return stock <= low;
}

function MedicineAutocomplete({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const debouncedValue = useDebouncedValue(value, 300);
  const { data } = useQuery({
    queryKey: ["med-autocomplete", debouncedValue],
    queryFn: () => fetchInventorySearch(debouncedValue),
    enabled: debouncedValue.trim().length >= 2,
  });
  const suggestions = Array.from(new Set((data ?? []).map((m: any) => m.medicine_name)));
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
        placeholder="Type karo — existing medicine dikhengi, ya nayi likh do"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 rounded-xl border border-border bg-background shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((name: any) => (
            <li key={name}>
              <button
                type="button"
                onMouseDown={() => { onChange(name); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-accent/15"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddStockModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [medicine, setMedicine] = useState("");
  const [potency, setPotency] = useState("");
  const [branch, setBranch] = useState(BRANCHES[0]);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const q = Number(qty);
    if (!medicine.trim() || !potency.trim() || !q || q <= 0) {
      toast.error("Medicine, potency aur valid quantity bharo");
      return;
    }
    setSaving(true);
    const res = await addStockEntry({ medicine_name: medicine.trim(), potency: potency.trim(), branch, quantity: q });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Stock add ho gaya");
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Add Stock Entry</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Medicine Name</label>
            <MedicineAutocomplete value={medicine} onChange={setMedicine} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Potency</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {COMMON_POTENCIES.map((p) => (
                <button key={p} type="button" onClick={() => setPotency(p)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", potency === p ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{p}</button>
              ))}
            </div>
            <input value={potency} onChange={(e) => setPotency(e.target.value)} className="w-full mt-1.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" placeholder="Ya alag potency likho" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Branch</label>
            <div className="flex gap-1.5 mt-1">
              {BRANCHES.map((b) => (
                <button key={b} onClick={() => setBranch(b)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{b}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Quantity (drams) to add</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" placeholder="e.g. 50" />
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Add Stock"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InventoryPage() {
  const [f, setF] = useState<"All" | "Low Stock">("All");
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const queryClient = useQueryClient();
  const rows = (data?.rows ?? []) as any[];
  const inventoryTruncated = data?.truncated ?? false;
  const list = f === "Low Stock" ? rows.filter(isLow) : rows;

  return (
    <RoleShell
      title="Inventory"
      subtitle="Current stock levels"
      nav={PHARMACY_NAV}
      right={
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5"
        >
          + Stock
        </button>
      }
    >
      {showAdd && (
        <AddStockModal onClose={() => setShowAdd(false)} onAdded={() => queryClient.invalidateQueries({ queryKey: ["inventory"] })} />
      )}
      <div className="flex gap-2">
        <Stat v={rows.length} l="Total Items" />
        <Stat v={rows.filter(isLow).length} l="Low Stock" tone="destructive" />
      </div>
      {inventoryTruncated && (
        <div className="mt-2 text-[11px] text-muted-foreground text-center">
          Sirf pehle 2000 items yahan dikh rahe hain — specific medicine chahiye toh search use karo.
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {(["All", "Low Stock"] as const).map((x) => (
          <button
            key={x}
            onClick={() => setF(x)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12px] font-semibold border",
              f === x ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
            )}
          >
            {x}
          </button>
        ))}
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyBlock label="Inventory khaali hai." />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {list.map((i, idx) => {
            const low = isLow(i);
            const stock = Number(i.stock_drams ?? i.stock ?? 0);
            const unit = i.unit ?? "drams";
            return (
              <li
                key={i.id ?? idx}
                className={cn(
                  "rounded-2xl bg-surface border border-border border-l-[4px] p-3.5 flex justify-between items-center",
                  low ? "border-l-destructive" : "border-l-success",
                )}
              >
                <div>
                  <div className="font-bold text-primary text-[15px]">
                    {i.medicine_name ?? i.med} {i.potency && i.potency !== "—" && i.potency}
                  </div>
                  {low && <div className="text-[12px] text-destructive font-semibold mt-0.5">⚠ Low stock — reorder soon</div>}
                </div>
                <div className="text-right">
                  <div className={cn("text-lg font-extrabold", low ? "text-destructive" : "text-primary")}>{stock}</div>
                  <div className="text-[11px] text-muted-foreground">{unit}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </RoleShell>
  );
}
