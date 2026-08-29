import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { RoleShell, Stat } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { PHARMACY_NAV } from "./pharmacy.index";
import { fetchInventory, addBulkStockEntries, fetchMedicinesCatalog, branchLabel, BRANCH_KEYS } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export const Route = createFileRoute("/pharmacy/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Pharmacy" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["PHARMA", "OWNER"]} permKey="inventory">
      <InventoryPage />
    </AuthGate>
  ),
});

// "Total" is a view, not a real branch — never sent to the DB, only used
// to pick which rows the list below shows.
const TOTAL = "TOTAL" as const;
const TABS = [...BRANCH_KEYS, TOTAL] as const;
const COMMON_POTENCIES = ["6", "30", "200", "1M", "10M", "50M", "CM", "Q"];

function isLow(row: any): boolean {
  const stock = Number(row.stock_drams ?? row.stock ?? 0);
  const low = Number(row.reorder_level ?? row.low ?? 20);
  return stock <= low;
}

// Catalog-sourced — picks from the Medicine Master list (typo-proof) but
// still lets Pharmacy type a name that isn't in the catalog yet; AddStockModal
// registers it in the catalog on submit before adding stock.
function MedicineAutocomplete({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const debouncedValue = useDebouncedValue(value, 300);
  const { data } = useQuery({
    queryKey: ["med-catalog-autocomplete", debouncedValue],
    queryFn: () => fetchMedicinesCatalog(debouncedValue, true),
    enabled: debouncedValue.trim().length >= 2,
  });
  const suggestions = data ?? [];
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
        placeholder="Master se pick karo, ya nayi likh do"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 rounded-xl border border-border bg-background shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={() => { onChange(m.name); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-accent/15"
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Rapid bulk-entry (05 Aug 2026, Dr. Yadav's request): with 180+ medicines
// each carrying several potencies across 2 branches, one-medicine-one-
// potency-one-branch-per-modal meant 500+ separate form submissions.
// Branch is picked ONCE per session (Pharmacy is physically standing in
// one branch counting bottles — they don't need the other branch's
// numbers open at the same time). Every common potency gets its own qty
// box up front; "Save & Next Medicine" submits every filled box in one
// action, then clears the form and keeps the modal open with the same
// branch, ready for the next medicine — so a whole shelf can be entered
// without reopening this sheet each time.
function AddStockModal({ defaultBranch, onClose, onAdded }: { defaultBranch: string; onClose: () => void; onAdded: () => void }) {
  const [medicine, setMedicine] = useState("");
  const [branch, setBranch] = useState(defaultBranch);
  const [qtyByPotency, setQtyByPotency] = useState<Record<string, string>>({});
  const [extraPotencies, setExtraPotencies] = useState<string[]>([]);
  const [newPotency, setNewPotency] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  const potencyRows = [...COMMON_POTENCIES, ...extraPotencies];

  const setQty = (p: string, v: string) => setQtyByPotency((cur) => ({ ...cur, [p]: v }));

  const addCustomPotency = () => {
    const p = newPotency.trim();
    if (!p || potencyRows.includes(p)) { setNewPotency(""); return; }
    setExtraPotencies((cur) => [...cur, p]);
    setNewPotency("");
  };

  const resetForNext = () => {
    setMedicine("");
    setQtyByPotency({});
    setExtraPotencies([]);
  };

  const submit = async () => {
    if (!medicine.trim()) { toast.error("Medicine naam bharo"); return; }
    const entries = potencyRows
      .map((p) => ({ potency: p, quantity: Number(qtyByPotency[p]) }))
      .filter((e) => e.quantity > 0);
    if (entries.length === 0) { toast.error("Kam se kam ek potency mein quantity bharo"); return; }

    setSaving(true);
    const result = await addBulkStockEntries(medicine.trim(), branch, entries);
    setSaving(false);

    if (result.failed.length === 0) {
      toast.success(`${medicine.trim()} — ${result.succeeded} potencies save ho gayi`);
    } else if (result.succeeded > 0) {
      toast.error(`${result.succeeded} saved, ${result.failed.length} fail: ${result.failed.map((f) => f.potency).join(", ")}`);
    } else {
      toast.error("Kuch save nahi hua: " + result.failed[0]?.error);
      return; // keep the form filled so they can retry, don't reset
    }
    setSessionCount((c) => c + 1);
    onAdded();
    resetForNext();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">Add Stock — Bulk</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {sessionCount > 0 && (
          <div className="text-[12px] text-success font-semibold mb-3">✓ {sessionCount} medicine{sessionCount > 1 ? "s" : ""} stocked is session mein</div>
        )}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Branch (poore session ke liye fix)</label>
            <div className="flex gap-1.5 mt-1">
              {BRANCH_KEYS.map((b) => (
                <button key={b} onClick={() => setBranch(b)} className={cn("flex-1 rounded-full px-3 py-2 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{branchLabel(b)}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Medicine Name</label>
            <MedicineAutocomplete value={medicine} onChange={setMedicine} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">
              Jitni potencies ka stock hai, sab bhar do — khaali chhod do jiska nahi hai
            </label>
            <div className="mt-1.5 rounded-xl border border-border overflow-hidden">
              {potencyRows.map((p, i) => (
                <div key={p} className={cn("flex items-center gap-2 px-3 py-2", i % 2 === 0 ? "bg-surface" : "bg-background")}>
                  <span className="text-[13px] font-bold text-primary w-14 shrink-0">{p}</span>
                  <input
                    value={qtyByPotency[p] ?? ""}
                    onChange={(e) => setQty(p, e.target.value)}
                    inputMode="numeric"
                    placeholder="qty"
                    className="flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={newPotency}
                onChange={(e) => setNewPotency(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomPotency(); } }}
                placeholder="Alag potency (e.g. 50M)"
                className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
              />
              <button type="button" onClick={addCustomPotency} className="rounded-full bg-muted text-primary text-[12px] font-bold px-3 py-1.5 shrink-0">
                + Row
              </button>
            </div>
          </div>
          <button onClick={submit} disabled={saving} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save & Next Medicine"}
          </button>
          <p className="text-[11px] text-muted-foreground text-center">Save karne ke baad form khaali ho jaayega, branch wahi rahega — turant agli medicine daal sakte ho.</p>
        </div>
      </div>
    </div>
  );
}

function InventoryPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>(BRANCH_KEYS[0]);
  const [f, setF] = useState<"All" | "Low Stock">("All");
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const queryClient = useQueryClient();
  const allRows = (data?.rows ?? []) as any[];
  const inventoryTruncated = data?.truncated ?? false;

  // Total view merges same medicine+potency across both branches into one
  // row with a combined stock figure — "kitni bottles kahan padi hain" is
  // answered by the branch tabs; Total answers "kitni bottles clinic mein
  // hain overall", which is a different, equally real question.
  const branchRows = tab === TOTAL ? allRows : allRows.filter((r) => r.branch === tab);
  const rows =
    tab === TOTAL
      ? Array.from(
          allRows.reduce((map, r) => {
            const key = `${r.medicine_name}__${r.potency ?? ""}`;
            const cur = map.get(key) ?? { ...r, stock_drams: 0, reorder_level: 0 };
            cur.stock_drams = Number(cur.stock_drams) + Number(r.stock_drams ?? 0);
            cur.reorder_level = Math.max(Number(cur.reorder_level), Number(r.reorder_level ?? 0));
            map.set(key, cur);
            return map;
          }, new Map<string, any>()).values(),
        )
      : branchRows;
  const list = f === "Low Stock" ? rows.filter(isLow) : rows;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["inventory"] });

  return (
    <RoleShell
      wide
      showBack
      title="Inventory"
      subtitle="Branch-wise stock"
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
        <AddStockModal defaultBranch={tab === TOTAL ? BRANCH_KEYS[0] : tab} onClose={() => setShowAdd(false)} onAdded={invalidate} />
      )}
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-full px-3 py-2 text-[12px] font-bold border text-center",
              tab === t ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
            )}
          >
            {t === TOTAL ? "Total (both)" : branchLabel(t)}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <Stat v={rows.length} l={tab === TOTAL ? "Total Items" : `${branchLabel(tab)} Items`} />
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
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyBlock label={tab === TOTAL ? "Inventory khaali hai." : `${branchLabel(tab)} mein stock khaali hai.`} />
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
                  {tab === TOTAL && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {BRANCH_KEYS.map((b) => `${branchLabel(b)}: ${allRows.filter((r) => r.medicine_name === i.medicine_name && r.potency === i.potency && r.branch === b).reduce((s, r) => s + Number(r.stock_drams ?? 0), 0)}`).join(" · ")}
                    </div>
                  )}
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
