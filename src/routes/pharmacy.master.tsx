import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, X, Pencil, Check, Ban, RotateCcw } from "lucide-react";
import { RoleShell, Stat } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { PHARMACY_NAV } from "./pharmacy.index";
import {
  fetchMedicinesCatalog,
  addMedicineToCatalog,
  renameMedicineInCatalog,
  setMedicineActive,
  fetchInventory,
  summarizeStockByMedicine,
  branchLabel,
  BRANCH_KEYS,
  type DBMedicine,
} from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pharmacy/master")({
  head: () => ({ meta: [{ title: "Medicine Master — Pharmacy" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["PHARMA", "OWNER"]} permKey="medicineMaster">
      <MasterPage />
    </AuthGate>
  ),
});
function AddMedicineModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Medicine naam likho");
      return;
    }
    setSaving(true);
    const res = await addMedicineToCatalog(name);
    setSaving(false);
    if (!res.success) {
      toast.error("Save nahi hua: " + res.error);
      return;
    }
    toast.success(`"${res.medicine?.name ?? name.trim()}" master mein add ho gayi`);
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Add New Medicine</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Medicine Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              placeholder="e.g. Nux Vomica"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Bas naam — potency aur stock Inventory se "+ Stock" karke branch-wise add hoga.
            </p>
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Add Medicine"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditRow({
  med,
  stockSummary,
  onSaved,
}: {
  med: DBMedicine;
  stockSummary?: { byBranch: Record<string, number>; total: number; potencies: Set<string> };
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(med.name);
  const [busy, setBusy] = useState(false);

  const saveRename = async () => {
    if (!name.trim() || name.trim() === med.name) { setEditing(false); setName(med.name); return; }
    setBusy(true);
    const res = await renameMedicineInCatalog(med.id, med.name, name);
    setBusy(false);
    if (!res.success) { toast.error("Rename nahi hua: " + res.error); return; }
    toast.success("Naam update ho gaya");
    setEditing(false);
    onSaved();
  };

  const toggleActive = async () => {
    setBusy(true);
    const res = await setMedicineActive(med.id, !med.is_active);
    setBusy(false);
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    toast.success(med.is_active ? "Medicine deactivate ho gayi" : "Medicine wapas active ho gayi");
    onSaved();
  };

  return (
    <li className={cn("rounded-2xl bg-surface border border-border p-3.5", !med.is_active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <div className="flex-1 flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="flex-1 rounded-lg border border-accent bg-background px-2.5 py-1.5 text-sm font-bold text-primary"
            />
            <button onClick={saveRename} disabled={busy} className="h-8 w-8 grid place-items-center rounded-full bg-success/15 text-success shrink-0">
              <Check className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex-1">
            <div className="font-bold text-primary text-[15px]">
              {med.name} {!med.is_active && <span className="text-[10px] font-semibold text-muted-foreground">(inactive)</span>}
            </div>
            {stockSummary ? (
              <div className="text-[12px] text-muted-foreground mt-0.5">
                {stockSummary.potencies.size > 0 && `Potencies: ${Array.from(stockSummary.potencies).join(", ")} · `}
                {BRANCH_KEYS.map((b) => `${branchLabel(b)}: ${stockSummary.byBranch[b] ?? 0}`).join(" · ")} · Total: {stockSummary.total}
              </div>
            ) : (
              <div className="text-[12px] text-muted-foreground mt-0.5">Abhi koi stock nahi — Inventory se "+ Stock" karo</div>
            )}
          </div>
        )}
        {!editing && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setEditing(true)} className="h-8 w-8 grid place-items-center rounded-full bg-muted text-primary">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={toggleActive} disabled={busy} className="h-8 w-8 grid place-items-center rounded-full bg-muted text-primary">
              {med.is_active ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function MasterPage() {
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const queryClient = useQueryClient();

  const { data: meds, isLoading } = useQuery({ queryKey: ["medicines-catalog"], queryFn: () => fetchMedicinesCatalog() });
  const { data: inv } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });

  const stockMap = summarizeStockByMedicine(inv?.rows ?? []);
  const all = meds ?? [];
  const visible = all
    .filter((m) => (showInactive ? true : m.is_active))
    .filter((m) => (q ? m.name.toLowerCase().includes(q.toLowerCase()) : true));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["medicines-catalog"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  return (
    <RoleShell
      wide
      showBack
      title="Medicine Master"
      subtitle={`${all.filter((m) => m.is_active).length} active medicines`}
      nav={PHARMACY_NAV}
      right={
        <button onClick={() => setShowAdd(true)} className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5">
          + Add
        </button>
      }
    >
      {showAdd && <AddMedicineModal onClose={() => setShowAdd(false)} onAdded={refresh} />}
      <div className="flex gap-2">
        <Stat v={all.filter((m) => m.is_active).length} l="Active" />
        <Stat v={all.filter((m) => !m.is_active).length} l="Inactive" />
      </div>
      <div className="relative mt-3">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search medicine"
          className="w-full rounded-full bg-surface border-2 border-accent pl-10 pr-4 py-3 text-sm text-primary outline-none"
        />
      </div>
      <button
        onClick={() => setShowInactive((v) => !v)}
        className={cn(
          "mt-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border",
          showInactive ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
        )}
      >
        {showInactive ? "Showing inactive too" : "Show inactive"}
      </button>
      {isLoading ? (
        <LoadingBlock />
      ) : visible.length === 0 ? (
        <EmptyBlock label="No medicines found." />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {visible.map((m) => (
            <EditRow key={m.id} med={m} stockSummary={stockMap.get(m.name)} onSaved={refresh} />
          ))}
        </ul>
      )}
    </RoleShell>
  );
}
