import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchWinbackTiers, saveWinbackTier, deleteWinbackTier, type WinbackTier } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/winback-tiers")({
  head: () => ({ meta: [{ title: "Win-back Tiers — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <WinbackTiersPage />
    </AuthGate>
  ),
});

function TierModal({
  tier,
  onClose,
  onSaved,
}: {
  tier: Partial<WinbackTier> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(tier?.label ?? "");
  const [days, setDays] = useState(String(tier?.days_lapsed ?? ""));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!label.trim() || days === "") { toast.error("Sab fields bharo"); return; }
    setSaving(true);
    const res = await saveWinbackTier({ id: tier?.id, label: label.trim(), days_lapsed: Number(days), active: tier?.active ?? true });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Tier save ho gaya");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">{tier?.id ? "Edit Tier" : "Naya Tier"}</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 60 din" className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Kitne din se nahi aaya</label>
            <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
          </div>
          <button onClick={save} disabled={saving} className="mt-2 w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WinbackTiersPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["winback-tiers"], queryFn: fetchWinbackTiers });
  const tiers = data ?? [];
  const [editTier, setEditTier] = useState<Partial<WinbackTier> | null | "new">(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["winback-tiers"] });

  const remove = async (id: string) => {
    if (!window.confirm("Ye tier delete karein?")) return;
    const res = await deleteWinbackTier(id);
    if (!res.success) { toast.error("Delete nahi hua: " + res.error); return; }
    toast.success("Tier delete ho gaya");
    reload();
  };

  return (
    <RoleShell wide title="Win-back Tiers" subtitle="Lapsed patients ko wapas laane ka schedule" showBack>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">Jitne bhi tiers, utni baar alag message jayega — 60 se rukna zaroori nahi.</p>
        <button
          onClick={() => setEditTier("new")}
          className="shrink-0 flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-bold"
        >
          <Plus className="h-3.5 w-3.5" /> Naya
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : tiers.length === 0 ? (
        <EmptyBlock label="Koi tier nahi hai — win-back messages nahi jayenge." />
      ) : (
        <div className="space-y-1.5">
          {tiers.map((t) => (
            <div key={t.id} className={cn("flex items-center justify-between rounded-xl border border-border p-3", t.active ? "bg-surface" : "bg-muted/50 opacity-60")}>
              <div className="text-sm">
                <span className="font-semibold">{t.label}</span>
                <span className="text-muted-foreground text-xs"> — {t.days_lapsed} din se nahi aaya</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setEditTier(t)} className="h-7 w-7 grid place-items-center rounded-full bg-accent/20 text-accent-foreground">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => remove(t.id)} className="h-7 w-7 grid place-items-center rounded-full bg-destructive/15 text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editTier && (
        <TierModal
          tier={editTier === "new" ? null : editTier}
          onClose={() => setEditTier(null)}
          onSaved={reload}
        />
      )}
    </RoleShell>
  );
}
