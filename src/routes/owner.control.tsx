import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchSettings, upsertSetting, fetchStaff } from "@/lib/db";
import type { BackupDoctorConfig } from "@/lib/auth";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/control")({
  head: () => ({ meta: [{ title: "Control Centre — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <ControlPage />
    </AuthGate>
  ),
});

function BackupDoctorModal({ onClose }: { onClose: () => void }) {
  const { data: staff } = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const existing: BackupDoctorConfig | null = (() => {
    const row = (settings ?? []).find((r: any) => r.key === "backup_doctor_config");
    try {
      return row?.value ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  })();

  const eligibleStaff = ((staff ?? []) as any[]).filter((s) => s.role !== "OWNER" && s.role !== "DOCTOR");
  const [userId, setUserId] = useState(existing?.userId ?? "");
  const [start, setStart] = useState(existing?.start?.slice(0, 16) ?? "");
  const [end, setEnd] = useState(existing?.end?.slice(0, 16) ?? "");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const save = async (enabled: boolean) => {
    if (enabled && (!userId || !start || !end)) {
      toast.error("Staff, start aur end time zaroori hai");
      return;
    }
    setSaving(true);
    const cfg: BackupDoctorConfig = {
      userId,
      start: start ? new Date(start).toISOString() : "",
      end: end ? new Date(end).toISOString() : "",
      enabled,
    };
    await upsertSetting("backup_doctor_config", JSON.stringify(cfg));
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast.success(enabled ? "Backup doctor access ON kar diya" : "Backup doctor access OFF kar diya");
    if (!enabled) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">Backup Doctor Access</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
          Chuni hui staff ko sirf is time-window ke andar hi temporary Doctor-app access milega, uske baad khud-ba-khud hat jaayega.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Staff member</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            >
              <option value="">— Select —</option>
              {eligibleStaff.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Start</label>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">End</label>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          </div>
          {existing?.enabled && (
            <button onClick={() => save(false)} disabled={saving} className="w-full rounded-full bg-destructive text-destructive-foreground font-bold py-3 text-sm disabled:opacity-50">
              Turn OFF now
            </button>
          )}
          <button onClick={() => save(true)} disabled={saving} className="w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : existing?.enabled ? "Update window" : "Activate for this window"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CONTROLS: { section: string; items: { k: string; on: boolean }[] }[] = [
  {
    section: "Clinic Operations",
    items: [
      { k: "Online booking", on: true },
      { k: "Walk-in registration", on: true },
      { k: "Courier delivery", on: true },
      { k: "Home visits", on: false },
    ],
  },
  {
    section: "Feature Modules",
    items: [
      { k: "Lead CRM", on: true },
      { k: "Follow-up CRM", on: true },
      { k: "WhatsApp automation", on: true },
      { k: "Marketing module", on: false },
    ],
  },
  {
    section: "Privacy & Access",
    items: [
      { k: "Hidden Identity Mode", on: true },
      { k: "Case-DR patient access", on: false },
    ],
  },
  {
    section: "Payment & Delivery",
    items: [
      { k: "Advance payment", on: false },
      { k: "COD delivery", on: true },
      { k: "Partial payment", on: true },
    ],
  },
];

function ControlPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [state, setState] = useState<Record<string, boolean>>({});
  const [showBackupModal, setShowBackupModal] = useState(false);

  const backupCfg: BackupDoctorConfig | null = (() => {
    const row = (data ?? []).find((r: any) => r.key === "backup_doctor_config");
    try {
      return row?.value ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  })();
  const backupIsOn = !!backupCfg?.enabled;

  useEffect(() => {
    const map: Record<string, boolean> = {};
    CONTROLS.forEach((sec) => sec.items.forEach((it) => (map[it.k] = it.on)));
    (data ?? []).forEach((r: any) => {
      if (r.key in map || CONTROLS.some((s) => s.items.some((i) => i.k === r.key))) {
        map[r.key] = r.value === "true" || r.value === true;
      }
    });
    setState(map);
  }, [data]);

  const toggle = async (k: string) => {
    const next = !state[k];
    setState((p) => ({ ...p, [k]: next }));
    try {
      await upsertSetting(k, String(next));
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: any) {
      setState((p) => ({ ...p, [k]: !next }));
      toast.error(e?.message ?? "Failed to save");
    }
  };

  return (
    <RoleShell
      title="Owner Control Centre"
      subtitle="Master switches"
      nav={OWNER_NAV}
      right={
        <Link
          to="/owner/health"
          className="rounded-full bg-white/15 text-primary-foreground text-[11px] px-3 py-1.5 font-semibold inline-flex items-center gap-1"
        >
          <Activity className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          {showBackupModal && <BackupDoctorModal onClose={() => setShowBackupModal(false)} />}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Backup Doctor
            </div>
            <button
              onClick={() => setShowBackupModal(true)}
              className="w-full rounded-2xl bg-surface border border-border p-3.5 flex items-center justify-between text-left"
            >
              <div>
                <div className="text-sm font-semibold text-primary">
                  {backupIsOn ? "Active — tap to change" : "Not active — tap to set up"}
                </div>
                {backupIsOn && backupCfg && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {new Date(backupCfg.start).toLocaleString("en-IN")} → {new Date(backupCfg.end).toLocaleString("en-IN")}
                  </div>
                )}
              </div>
              <span className={cn("h-3 w-3 rounded-full shrink-0", backupIsOn ? "bg-success" : "bg-border")} />
            </button>
          </div>
          {CONTROLS.map((sec) => (
            <div key={sec.section}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                {sec.section}
              </div>
              <div className="rounded-2xl bg-surface border border-border p-1.5">
                {sec.items.map((it, i) => (
                  <div
                    key={it.k}
                    className={cn(
                      "flex justify-between items-center px-3 py-3",
                      i < sec.items.length - 1 && "border-b border-border",
                    )}
                  >
                    <span className="text-sm text-primary">{it.k}</span>
                    <button
                      onClick={() => toggle(it.k)}
                      className={cn(
                        "relative h-7 w-12 rounded-full transition",
                        state[it.k] ? "bg-success" : "bg-border",
                      )}
                      aria-pressed={state[it.k]}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all",
                          state[it.k] ? "left-[22px]" : "left-0.5",
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 rounded-xl bg-success/10 text-success p-3 text-[12px]">
        ✅ Toggles ab live — settings table mein permanently save ho rahe hain
      </div>
    </RoleShell>
  );
}
