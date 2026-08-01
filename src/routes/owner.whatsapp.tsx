import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthGate } from "@/components/yhc/AuthGate";
import { RoleShell, Stat, Badge } from "@/components/yhc/RoleShell";
import { fetchWhatsAppLog, fetchWhatsAppStats, fetchRecentConsentChanges } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp Delivery — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <WhatsAppDashboard />
    </AuthGate>
  ),
});

type StatusFilter = "all" | "sent" | "failed" | "skipped_consent";

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: "Sab",
  sent: "Sent",
  failed: "Failed",
  skipped_consent: "No-consent",
};

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
    <RoleShell wide title="WhatsApp Delivery" subtitle="Sent / failed / opt-out — live log" showBack>
      <div className="grid grid-cols-3 gap-2">
        <Stat v={s?.sentToday ?? "—"} l="Sent aaj" tone="success" />
        <Stat v={s?.failedToday ?? "—"} l="Failed aaj" tone="destructive" />
        <Stat v={s?.skippedToday ?? "—"} l="No-consent aaj" tone="accent" />
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
                <span className="text-[13px] font-semibold text-primary">{c.campaign_name}</span>
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
                <div className="text-[11px] text-muted-foreground">{entry.campaign_name}</div>
              </div>
              <Badge tone={entry.status === "sent" ? "success" : entry.status === "failed" ? "destructive" : "warn"}>
                {entry.status === "sent" ? "✓ Sent" : entry.status === "failed" ? "✗ Failed" : "No consent"}
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
