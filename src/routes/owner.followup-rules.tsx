import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchFollowupTouchpoints, saveFollowupTouchpoint, deleteFollowupTouchpoint, type FollowupTouchpoint } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/followup-rules")({
  head: () => ({ meta: [{ title: "Follow-up Rules — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <FollowupRulesPage />
    </AuthGate>
  ),
});

function RuleModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: Partial<FollowupTouchpoint> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(rule?.label ?? "");
  const [minGap, setMinGap] = useState(String(rule?.min_gap_days ?? ""));
  const [maxGap, setMaxGap] = useState(String(rule?.max_gap_days ?? ""));
  const [daysBefore, setDaysBefore] = useState(String(rule?.days_before_due ?? ""));
  const [channel, setChannel] = useState<"CALL" | "WHATSAPP">(rule?.channel ?? "WHATSAPP");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!label.trim() || minGap === "" || maxGap === "" || daysBefore === "" || daysBefore === "-") {
      toast.error("Sab fields bharo");
      return;
    }
    setSaving(true);
    const res = await saveFollowupTouchpoint({
      id: rule?.id,
      label: label.trim(),
      min_gap_days: Number(minGap),
      max_gap_days: Number(maxGap),
      days_before_due: Number(daysBefore),
      channel,
      active: rule?.active ?? true,
    });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Rule save ho gaya");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">{rule?.id ? "Edit Rule" : "Naya Rule"}</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. T-15" className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Gap se (din)</label>
              <input inputMode="numeric" value={minGap} onChange={(e) => setMinGap(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Gap tak (din)</label>
              <input inputMode="numeric" value={maxGap} onChange={(e) => setMaxGap(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Due date se kitne din pehle (ya baad mein) message jaye</label>
            {/* 04 Aug 2026: negative now allowed — a "-" followed by digits
                means the touchpoint fires AFTER the due date, for the
                staged post-due chase sequence. Positive/zero still means
                before-or-on the due date, same as always. */}
            <input
              inputMode="numeric"
              value={daysBefore}
              onChange={(e) => setDaysBefore(e.target.value.replace(/[^\d-]/g, "").replace(/(?!^)-/g, ""))}
              placeholder="e.g. 7, ya -2 (due date ke 2 din baad)"
              className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Channel</label>
            <div className="flex gap-1.5 mt-1">
              {(["CALL", "WHATSAPP"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[12px] font-bold border",
                    channel === c ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                  )}
                >
                  {c === "CALL" ? "Call (manual worklist)" : "WhatsApp (auto-send)"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Matlab: agar doctor ne next-visit gap {minGap || "X"}–{maxGap || "Y"} din ka rakha,
            {Number(daysBefore) >= 0
              ? ` toh due date se ${daysBefore || "N"} din pehle`
              : ` toh due date ke ${Math.abs(Number(daysBefore || 0))} din baad`}
            {" "}ek {channel === "CALL" ? "call reminder (worklist mein)" : "WhatsApp reminder"} jayega.
          </p>
          <button onClick={save} disabled={saving} className="mt-2 w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FollowupRulesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["followup-touchpoints"], queryFn: fetchFollowupTouchpoints });
  const rules = data ?? [];
  const [editRule, setEditRule] = useState<Partial<FollowupTouchpoint> | null | "new">(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["followup-touchpoints"] });

  const remove = async (id: string) => {
    if (!window.confirm("Ye rule delete karein?")) return;
    const res = await deleteFollowupTouchpoint(id);
    if (!res.success) { toast.error("Delete nahi hua: " + res.error); return; }
    toast.success("Rule delete ho gaya");
    reload();
  };

  // Group by gap bracket for a readable display
  const grouped = rules.reduce<Record<string, FollowupTouchpoint[]>>((acc, r) => {
    const key = `${r.min_gap_days}-${r.max_gap_days}`;
    (acc[key] ??= []).push(r);
    return acc;
  }, {});

  return (
    <RoleShell wide title="Follow-up Rules" subtitle="Sequences jab bhi chaho badal do" showBack>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">Gap ke hisaab se follow-up reminders — koi bhi rule add/edit/delete karo.</p>
        <button
          onClick={() => setEditRule("new")}
          className="shrink-0 flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-bold"
        >
          <Plus className="h-3.5 w-3.5" /> Naya
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : rules.length === 0 ? (
        <EmptyBlock label="Koi rule nahi hai — sab patients ko sirf ek default reminder jayega." />
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([key, items]) => {
            const [min, max] = key.split("-");
            return (
              <div key={key} className="rounded-xl bg-surface border border-border p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  Gap: {min}–{max} din
                </div>
                <div className="space-y-1.5">
                  {items.map((r) => (
                    <div key={r.id} className={cn("flex items-center justify-between rounded-lg px-2.5 py-2", r.active ? "bg-background" : "bg-muted/50 opacity-60")}>
                      <div className="text-xs">
                        <span className="font-semibold">{r.label}</span>
                        <span
                          className={cn(
                            "ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                            r.channel === "CALL" ? "bg-primary/10 text-primary" : "bg-success/15 text-success",
                          )}
                        >
                          {r.channel === "CALL" ? "Call" : "WA"}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}— due date se {r.days_before_due >= 0 ? `${r.days_before_due}d pehle` : `${Math.abs(r.days_before_due)}d baad`}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => setEditRule(r)} className="h-7 w-7 grid place-items-center rounded-full bg-accent/20 text-accent-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => remove(r.id)} className="h-7 w-7 grid place-items-center rounded-full bg-destructive/15 text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editRule && (
        <RuleModal
          rule={editRule === "new" ? null : editRule}
          onClose={() => setEditRule(null)}
          onSaved={reload}
        />
      )}
    </RoleShell>
  );
}
