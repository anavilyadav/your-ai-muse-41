import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Power, RotateCcw } from "lucide-react";
import { AuthGate } from "@/components/yhc/AuthGate";
import { RoleShell, Stat, Badge } from "@/components/yhc/RoleShell";
import {
  fetchWhatsAppLog,
  fetchWhatsAppStats,
  fetchRecentConsentChanges,
  fetchWhatsAppControls,
  saveWhatsAppControls,
  resetWhatsAppToFullAutomatic,
  WHATSAPP_CAMPAIGNS,
  DEFAULT_WHATSAPP_CONTROLS,
  type WhatsAppControls,
} from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp Delivery — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <WhatsAppDashboard />
    </AuthGate>
  ),
});

type StatusFilter = "all" | "sent" | "failed" | "skipped_consent" | "skipped_disabled" | "skipped_cap";

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: "Sab",
  sent: "Sent",
  failed: "Failed",
  skipped_consent: "No-consent",
  skipped_disabled: "Paused",
  skipped_cap: "Cap hit",
};

const CAMPAIGN_LABEL: Record<string, string> = {
  REGISTRATION_CONFIRM: "Registration Confirm",
  APPOINTMENT_REMINDER: "Appointment Reminder",
  FOLLOWUP_REMINDER: "Follow-up Reminder",
  BIRTHDAY_WISH: "Birthday Wish",
  ANNIVERSARY_WISH: "Anniversary Wish",
  HOLIDAY_GREETING: "Holiday Greeting",
  WINBACK: "Win-back",
};

// Master + per-campaign on/off + daily cap (10 Aug 2026, Dr. Yadav's
// request ahead of a large historical-data import) — stays fully automatic
// day to day, but can be paused instantly (whole system or just one
// campaign) and per-campaign sends capped to control AiSensy cost, with a
// single button to snap back to full-automatic. The actual gate check runs
// server-side in every sending Edge Function — this screen only edits the
// settings those functions read, so a change here takes effect on the very
// next send, with no separate deploy step.
function WhatsAppControlsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["whatsapp-controls"], queryFn: fetchWhatsAppControls });
  const [controls, setControls] = useState<WhatsAppControls>(DEFAULT_WHATSAPP_CONTROLS);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !loadedOnce) {
      setControls(data);
      setLoadedOnce(true);
    }
  }, [data, loadedOnce]);

  const save = async (next: WhatsAppControls) => {
    setControls(next);
    setSaving(true);
    try {
      await saveWhatsAppControls(next);
      qc.invalidateQueries({ queryKey: ["whatsapp-controls"] });
    } catch (e: any) {
      toast.error("Save nahi hua: " + (e?.message ?? "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const toggleMaster = () => save({ ...controls, masterEnabled: !controls.masterEnabled });

  const toggleModule = (campaign: string) =>
    save({
      ...controls,
      modules: {
        ...controls.modules,
        [campaign]: { ...controls.modules[campaign as keyof typeof controls.modules], enabled: !controls.modules[campaign as keyof typeof controls.modules]?.enabled },
      },
    });

  const setCap = (campaign: string, raw: string) => {
    const n = raw.trim() === "" ? null : Math.max(0, Number(raw) || 0);
    save({
      ...controls,
      modules: {
        ...controls.modules,
        [campaign]: { ...controls.modules[campaign as keyof typeof controls.modules], dailyCap: n },
      },
    });
  };

  const resetToAutomatic = async () => {
    if (!window.confirm("Sab kuch wapas full-automatic kar dein? (Sab ON, koi cap nahi)")) return;
    setSaving(true);
    try {
      await resetWhatsAppToFullAutomatic();
      setControls(DEFAULT_WHATSAPP_CONTROLS);
      qc.invalidateQueries({ queryKey: ["whatsapp-controls"] });
      toast.success("Wapas full-automatic ho gaya");
    } catch (e: any) {
      toast.error("Reset nahi hua: " + (e?.message ?? "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return null;

  return (
    <div className="rounded-2xl bg-surface border border-border p-3.5 space-y-3">
      <button
        onClick={toggleMaster}
        disabled={saving}
        className={cn(
          "w-full rounded-xl p-4 flex items-center justify-between font-bold disabled:opacity-60",
          controls.masterEnabled ? "bg-success/15 border border-success/40 text-success" : "bg-destructive/15 border border-destructive/40 text-destructive",
        )}
      >
        <span className="flex items-center gap-2">
          <Power className="h-5 w-5" />
          WhatsApp {controls.masterEnabled ? "ON — sab automatic chal raha hai" : "OFF — kuch bhi WhatsApp nahi jayega"}
        </span>
        <span className="text-[11px] underline">{controls.masterEnabled ? "Turn OFF" : "Turn ON"}</span>
      </button>

      {!controls.masterEnabled && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-2.5 text-[11px] text-destructive">
          Master switch OFF hai — koi bhi WhatsApp message (registration, reminders, birthday, winback, sab) nahi jayega, chahe neeche kuch bhi ON ho.
        </div>
      )}

      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground pt-1">
        Module-wise (khaali cap = unlimited)
      </div>
      {WHATSAPP_CAMPAIGNS.map((c) => {
        const mod = controls.modules[c] ?? { enabled: true, dailyCap: null };
        return (
          <div key={c} className="flex items-center justify-between gap-2 py-1">
            <button
              onClick={() => toggleModule(c)}
              disabled={saving}
              className={cn(
                "flex-1 text-left text-[13px] font-medium truncate",
                mod.enabled ? "text-primary" : "text-muted-foreground line-through",
              )}
            >
              {CAMPAIGN_LABEL[c] ?? c}
            </button>
            <input
              type="number" min={0}
              placeholder="—"
              value={mod.dailyCap ?? ""}
              onChange={(e) => setCap(c, e.target.value)}
              disabled={saving}
              className="w-14 rounded-lg border border-border bg-background text-[12px] px-2 py-1.5 text-center"
            />
            <button
              onClick={() => toggleModule(c)}
              disabled={saving}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border",
                mod.enabled ? "bg-success/15 border-success/40 text-success" : "bg-surface border-border text-muted-foreground",
              )}
            >
              {mod.enabled ? "ON" : "OFF"}
            </button>
          </div>
        );
      })}

      <button
        onClick={resetToAutomatic}
        disabled={saving}
        className="w-full rounded-xl border border-primary/40 text-primary font-bold py-2.5 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        <RotateCcw className="h-4 w-4" /> Reset — wapas full-automatic
      </button>
    </div>
  );
}

function WhatsAppDashboard() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const stats = useQuery({ queryKey: ["whatsapp-stats"], queryFn: fetchWhatsAppStats });
  const log = useQuery({
    queryKey: ["whatsapp-log", filter],
    queryFn: () => fetchWhatsAppLog(filter === "all" ? { limit: 100 } : { status: filter, limit: 100 }),
  });
  const consentChanges = useQuery({ queryKey: ["wa-consent-log"], queryFn: () => fetchRecentConsentChanges(10) });

  const s = stats.data;

  return (
    <RoleShell wide title="WhatsApp Delivery" subtitle="On/off, caps, sent / failed / opt-out — live log" showBack>
      <WhatsAppControlsPanel />

      <div className="grid grid-cols-3 gap-2 mt-4">
        <Stat v={s?.sentToday ?? "—"} l="Sent aaj" tone="success" />
        <Stat v={s?.failedToday ?? "—"} l="Failed aaj" tone="destructive" />
        <Stat v={s?.skippedToday ?? "—"} l="No-consent aaj" tone="accent" />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Stat v={s?.disabledToday ?? "—"} l="Paused (switch off) aaj" tone="destructive" />
        <Stat v={s?.cappedToday ?? "—"} l="Cap hit aaj" tone="accent" />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <Stat v={s?.sentWeek ?? "—"} l="Sent 7 din" tone="primary" />
        <Stat v={s?.failedWeek ?? "—"} l="Failed 7 din" tone="destructive" />
        <Stat v={s?.skippedWeek ?? "—"} l="No-consent 7 din" tone="accent" />
      </div>

      {s && s.byCampaign.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Campaign-wise (7 din)
          </div>
          <ul className="space-y-1.5">
            {s.byCampaign.map((c) => (
              <li key={c.campaign_name} className="rounded-xl bg-surface border border-border p-2.5 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-primary">{CAMPAIGN_LABEL[c.campaign_name] ?? c.campaign_name}</span>
                <span className="text-[11px] text-muted-foreground">
                  ✓ {c.sent} sent • ✗ {c.failed} failed
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex gap-1.5 overflow-x-auto">
        {(Object.keys(FILTER_LABEL) as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold border",
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-muted-foreground border-border",
            )}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <ul className="mt-3 space-y-2">
        {(log.data ?? []).map((entry) => (
          <li key={entry.id} className="rounded-xl bg-surface border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-primary truncate">
                  {entry.patient?.name ?? entry.destination ?? "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">{CAMPAIGN_LABEL[entry.campaign_name] ?? entry.campaign_name}</div>
              </div>
              <Badge tone={entry.status === "sent" ? "success" : entry.status === "failed" || entry.status === "skipped_disabled" ? "destructive" : "warn"}>
                {entry.status === "sent" ? "✓ Sent" : entry.status === "failed" ? "✗ Failed" : entry.status === "skipped_disabled" ? "Paused" : entry.status === "skipped_cap" ? "Cap hit" : "No consent"}
              </Badge>
            </div>
            {entry.error_message && (
              <div className="text-[10px] text-destructive mt-1 truncate">{entry.error_message}</div>
            )}
            <div className="text-[10px] text-muted-foreground mt-1">
              {new Date(entry.created_at).toLocaleString("en-IN")}
            </div>
          </li>
        ))}
        {log.data && log.data.length === 0 && (
          <div className="text-center text-[12px] text-muted-foreground py-8">Koi record nahi mila</div>
        )}
      </ul>

      {consentChanges.data && consentChanges.data.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Recent Consent Changes
          </div>
          <ul className="space-y-1.5">
            {consentChanges.data.map((c) => (
              <li key={c.id} className="rounded-xl bg-surface border border-border p-2.5 flex items-center justify-between">
                <span className="text-[13px] text-primary">{c.patient?.name ?? "—"}</span>
                <span className="text-[11px] text-muted-foreground">
                  {c.old_value ? "ON" : "OFF"} → {c.new_value ? "ON" : "OFF"} • {new Date(c.changed_at).toLocaleDateString("en-IN")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </RoleShell>
  );
}
