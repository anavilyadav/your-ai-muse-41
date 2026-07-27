import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchSettings, upsertSetting, fetchStaff } from "@/lib/db";
import type { BackupDoctorConfig } from "@/lib/auth";
import { RECEPTION_SCREENS } from "@/lib/auth";
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
    try {
      await upsertSetting("backup_doctor_config", JSON.stringify(cfg));
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(enabled ? "Backup doctor access ON kar diya" : "Backup doctor access OFF kar diya");
      if (!enabled) onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    } finally {
      setSaving(false);
    }
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

function ReceptionPermissionsGrid({ settings }: { settings: any[] }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const isOn = (role: "RECP1" | "RECP2", key: string) => {
    const row = settings.find((r: any) => r.key === `recp_perm:${role}:${key}`);
    return row ? (row.value === "true" || row.value === true) : true; // default ON
  };

  const toggle = async (role: "RECP1" | "RECP2", key: string) => {
    const k = `recp_perm:${role}:${key}`;
    const next = !isOn(role, key);
    setPending(k);
    try {
      await upsertSetting(k, String(next));
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    }
    setPending(null);
  };

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Reception Permissions — per screen ON/OFF
      </div>
      <div className="rounded-2xl bg-surface border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] bg-primary text-primary-foreground text-[11px] font-bold px-3 py-2">
          <span>Screen</span>
          <span className="w-12 text-center">RECP1</span>
          <span className="w-12 text-center">RECP2</span>
        </div>
        {RECEPTION_SCREENS.map((s, i) => (
          <div
            key={s.key}
            className={cn(
              "grid grid-cols-[1fr_auto_auto] items-center px-3 py-2.5",
              i < RECEPTION_SCREENS.length - 1 && "border-b border-border",
            )}
          >
            <span className="text-[13px] text-primary truncate pr-2">{s.label}</span>
            {(["RECP1", "RECP2"] as const).map((role) => {
              const on = isOn(role, s.key);
              const k = `recp_perm:${role}:${s.key}`;
              return (
                <button
                  key={role}
                  onClick={() => toggle(role, s.key)}
                  disabled={pending === k}
                  className={cn(
                    "w-12 flex justify-center",
                  )}
                >
                  <span
                    className={cn(
                      "relative h-5 w-9 rounded-full transition inline-block",
                      on ? "bg-success" : "bg-border",
                      pending === k && "opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                        on ? "left-[18px]" : "left-0.5",
                      )}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        Default sabke liye ON hai. Jisko rokna ho us role ka wahi switch OFF kar do — turant apply hoga.
      </p>
    </div>
  );
}

// The 14 clinic-ops / feature-module / privacy / payment toggles that used
// to live here were removed: they wrote to `settings` but no code path
// anywhere in the app ever read those keys, so flipping them did nothing.
// Rather than shipping placebo switches, the sections are gone entirely.
// Real gates that DO work stay above: Reception Permissions (read by
// AuthGate/useAuth) and Backup Doctor Access (read by useEffectiveRole).


function ControlPage() {
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
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
          <ReceptionPermissionsGrid settings={data ?? []} />
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
        </div>
      )}
    </RoleShell>
  );
}

