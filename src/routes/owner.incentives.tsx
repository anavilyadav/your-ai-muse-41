import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchOwnerStats, fetchStaff, fetchIncentiveSplits, saveIncentiveSplits, fetchIncentiveConfig, saveIncentiveConfig, type IncentiveConfig } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/incentives")({
  head: () => ({ meta: [{ title: "Incentives — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <IncentivesPage />
    </AuthGate>
  ),
});

const INCENTIVE_ROLES = ["RECP1", "RECP2", "CALLING", "TELECALLER"];

function SplitModal({
  staff,
  current,
  onClose,
  onSaved,
}: {
  staff: any[];
  current: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const equalDefault = staff.length ? Math.round(100 / staff.length) : 0;
  const [values, setValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {};
    staff.forEach((s) => { v[s.id] = current[s.id] ?? equalDefault; });
    return v;
  });
  const [saving, setSaving] = useState(false);

  const total = Object.values(values).reduce((a, b) => a + (Number(b) || 0), 0);

  const save = async () => {
    if (total === 0) {
      toast.error("Kam se kam ek staff ko % dena hoga");
      return;
    }
    setSaving(true);
    await saveIncentiveSplits(values);
    setSaving(false);
    toast.success("Split save ho gaya");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">Adjust Split</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4">Owner discretion — har staff ka % set karo. Total 100% se kam-zyada bhi chalega, proportionally split hoga.</p>
        <div className="flex flex-col gap-3">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-primary text-[14px] truncate">{s.name}</div>
                <div className="text-[11px] text-muted-foreground">{s.role}</div>
              </div>
              <input
                type="number"
                min={0}
                max={100}
                value={values[s.id] ?? 0}
                onChange={(e) => {
                  // HTML min/max on a number input only affect the spinner
                  // arrows, not typed/pasted values — this was accepting
                  // -50 or 9999 as a real percentage. Clamp explicitly.
                  const raw = Number(e.target.value) || 0;
                  const clamped = Math.max(0, Math.min(100, raw));
                  setValues((v) => ({ ...v, [s.id]: clamped }));
                }}
                className="w-20 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-right font-bold"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[12px] text-muted-foreground text-right">Total: {total}%</div>
        <button onClick={save} disabled={saving} className="mt-4 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Save Split"}
        </button>
      </div>
    </div>
  );
}

function ConfigModal({
  current,
  onClose,
  onSaved,
}: {
  current: IncentiveConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [baseline, setBaseline] = useState(current.baseline);
  const [poolPercent, setPoolPercent] = useState(current.poolPercent);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (baseline < 0 || poolPercent < 0 || poolPercent > 100) {
      toast.error("Baseline 0+ aur Pool% 0-100 ke beech hona chahiye");
      return;
    }
    setSaving(true);
    await saveIncentiveConfig({ baseline, poolPercent });
    setSaving(false);
    toast.success("Config save ho gayi");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">Baseline & Pool %</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4">Ye pehle code mein hardcoded thi — ab yahin se badal sakte ho, dobara deploy ki zaroorat nahi.</p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Monthly Baseline (₹)</label>
            <input
              type="number"
              min={0}
              value={baseline}
              onChange={(e) => setBaseline(Math.max(0, Number(e.target.value) || 0))}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Pool % of Growth</label>
            <input
              type="number"
              min={0}
              max={100}
              value={poolPercent}
              onChange={(e) => setPoolPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
        </div>
        <button onClick={save} disabled={saving} className="mt-4 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Save Config"}
        </button>
      </div>
    </div>
  );
}

function IncentivesPage() {
  const stats = useQuery({ queryKey: ["owner-stats"], queryFn: fetchOwnerStats });
  const staffQ = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const splitsQ = useQuery({ queryKey: ["incentive-splits"], queryFn: fetchIncentiveSplits });
  const configQ = useQuery({ queryKey: ["incentive-config"], queryFn: fetchIncentiveConfig });
  const queryClient = useQueryClient();
  const [showSplit, setShowSplit] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const month = stats.data?.monthRevenue ?? 0;
  const baseline = configQ.data?.baseline ?? 100000;
  const poolPercent = configQ.data?.poolPercent ?? 4;
  const growth = Math.max(0, month - baseline);
  const pool = Math.round(growth * (poolPercent / 100));

  const staff = ((staffQ.data ?? []) as any[]).filter((s) =>
    INCENTIVE_ROLES.includes(s.role ?? ""),
  );
  const splits = splitsQ.data ?? {};
  const hasManualSplit = Object.keys(splits).length > 0;
  const totalWeight = staff.reduce((sum, s) => sum + (splits[s.id] ?? (hasManualSplit ? 0 : 100 / Math.max(1, staff.length))), 0) || 1;

  const shareFor = (s: any) => {
    const weight = splits[s.id] ?? (hasManualSplit ? 0 : 100 / Math.max(1, staff.length));
    return Math.round((weight / totalWeight) * pool);
  };

  return (
    <RoleShell wide title="Staff Incentives" subtitle={`${poolPercent}% of revenue above baseline`} showBack>
      {showSplit && (
        <SplitModal
          staff={staff}
          current={splits}
          onClose={() => setShowSplit(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["incentive-splits"] })}
        />
      )}
      {showConfig && (
        <ConfigModal
          current={{ baseline, poolPercent }}
          onClose={() => setShowConfig(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["incentive-config"] })}
        />
      )}
      <div className="rounded-2xl bg-primary text-primary-foreground p-4">
        <div className="text-[13px] text-primary-foreground/65">Incentive Pool This Month</div>
        <div className="text-3xl font-extrabold text-accent mt-1">₹{pool.toLocaleString("en-IN")}</div>
        <div className="text-[12px] text-primary-foreground/60 mt-0.5">
          {poolPercent}% of ₹{growth.toLocaleString("en-IN")} growth above ₹{baseline.toLocaleString("en-IN")} baseline
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-accent/25 text-accent-foreground p-3 text-[12px]">
        💡 {hasManualSplit ? "Owner discretion split active — % neeche dikh raha hai" : "Abhi equal split ho raha hai — 'Adjust Split' se performance-based kar sakte ho"}
      </div>

      {stats.isLoading || staffQ.isLoading ? (
        <LoadingBlock />
      ) : staff.length === 0 ? (
        <EmptyBlock label="No incentive-eligible staff found." />
      ) : (
        <ul className="mt-3 space-y-2.5">
          {staff.map((s: any) => {
            const share = shareFor(s);
            return (
              <li key={s.id} className="rounded-2xl bg-surface border border-border p-3.5">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-primary text-[15px]">{s.name}</div>
                    <div className="text-[12px] text-muted-foreground">{s.role}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-extrabold text-success">₹{share.toLocaleString("en-IN")}</div>
                    <div className="text-[11px] text-muted-foreground">earned</div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-[12px] text-muted-foreground mb-1">
                    <span>{splits[s.id] ?? Math.round(100 / staff.length)}% weight</span>
                    <span className={cn("font-bold", pool > 0 ? "text-success" : "text-muted-foreground")}>
                      {pool > 0 ? "Active" : "No growth yet"}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-accent/30">
                    <div
                      className="h-2 rounded-full bg-success"
                      style={{ width: `${pool > 0 ? 100 : 0}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button
        onClick={() => setShowSplit(true)}
        className="mt-4 w-full rounded-full bg-surface border border-border text-primary font-bold py-3 text-sm"
      >
        Adjust Split (Owner Discretion)
      </button>
      <button
        onClick={() => setShowConfig(true)}
        className="mt-2 w-full rounded-full bg-surface border border-border text-primary font-bold py-3 text-sm"
      >
        Adjust Baseline / Pool %
      </button>
    </RoleShell>
  );
}
