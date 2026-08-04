import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { PHARMACY_NAV } from "./pharmacy.index";
import { fetchMasterMedicines, addStockEntry, BRANCH_LABELS } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pharmacy/master")({
  head: () => ({ meta: [{ title: "Medicine Master — Pharmacy" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["PHARMA", "OWNER"]} permKey="medicineMaster">
      <MasterPage />
    </AuthGate>
  ),
});

const BRANCHES = BRANCH_LABELS;
const COMMON_POTENCIES = ["6", "30", "200", "1M", "10M", "CM", "Q"];
const COMMON_TYPES = ["Dilution", "Mother Tincture", "Biochemic", "Trituration"];

function AddMedicineModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [medicine, setMedicine] = useState("");
  const [potency, setPotency] = useState("");
  const [type, setType] = useState("");
  const [branch, setBranch] = useState(BRANCHES[0]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!medicine.trim() || !potency.trim()) {
      toast.error("Medicine naam aur potency zaroori hai");
      return;
    }
    setSaving(true);
    // Adds it into the master list with 0 starting stock — pharmacy can
    // top up quantity anytime from Inventory → + Stock.
    const res = await addStockEntry({ medicine_name: medicine.trim(), potency: potency.trim(), branch, quantity: 0, type: type.trim() || undefined });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Medicine master mein add ho gayi");
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Add New Medicine</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Medicine Name</label>
            <input value={medicine} onChange={(e) => setMedicine(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" placeholder="e.g. Nux Vomica" />
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
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Type (optional)</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {COMMON_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => setType(t)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", type === t ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Branch</label>
            <div className="flex gap-1.5 mt-1">
              {BRANCHES.map((b) => (
                <button key={b} onClick={() => setBranch(b)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{b}</button>
              ))}
            </div>
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Add Medicine"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MasterPage() {
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["master-medicines"], queryFn: fetchMasterMedicines });
  const queryClient = useQueryClient();
  const all = data ?? [];
  const list = q ? all.filter((m) => m.med.toLowerCase().includes(q.toLowerCase())) : all;
  return (
    <RoleShell
      wide
      title="Medicine Master"
      subtitle="Reference list"
      nav={PHARMACY_NAV}
      right={
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5"
        >
          + Add
        </button>
      }
    >
      {showAdd && (
        <AddMedicineModal onClose={() => setShowAdd(false)} onAdded={() => queryClient.invalidateQueries({ queryKey: ["master-medicines"] })} />
      )}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search medicine"
          className="w-full rounded-full bg-surface border-2 border-accent pl-10 pr-4 py-3 text-sm text-primary outline-none"
        />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyBlock label="No medicines found." />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {list.map((m, i) => (
            <li key={i} className="rounded-2xl bg-surface border border-border p-3.5">
              <div className="font-bold text-primary text-[15px]">{m.med}</div>
              <div className="text-[12px] text-muted-foreground mt-0.5">Potencies: {m.potencies.join(", ") || "—"}</div>
              {m.type && <div className="text-[12px] text-muted-foreground">{m.type}</div>}
            </li>
          ))}
        </ul>
      )}
    </RoleShell>
  );
}
