import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, MessageCircle, CheckCircle2, History } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { InteractionHistoryModal } from "@/components/yhc/InteractionHistoryModal";
import { fetchFollowups, markFollowupDone, logWhatsAppInteraction } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/follow-up")({
  head: () => ({ meta: [{ title: "Follow-up Calls — YHC" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="followup">
      <FollowUpPage />
    </AuthGate>
  ),
});

function FollowUpPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["followups"], queryFn: fetchFollowups });
  const rows = (data ?? []) as any[];
  const [historyPatient, setHistoryPatient] = useState<{ id: string; name: string } | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const daysDiff = (d: string) => Math.floor((Date.parse(today) - Date.parse(d)) / 86_400_000);

  const done = async (id: string) => {
    try {
      await markFollowupDone(id);
      qc.invalidateQueries({ queryKey: ["followups"] });
    } catch (e: any) {
      toast.error("Update nahi hua: " + (e?.message ?? "unknown error"));
    }
  };

  const overdue = rows.filter((r) => daysDiff(r.due_date) > 7).length;
  const dueSoon = rows.filter((r) => daysDiff(r.due_date) <= 7).length;

  return (
    <MobileShell title="Follow-up Calls" subtitle="Today" showBack>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Due" value={rows.length} tone="primary" />
        <Stat label="Overdue" value={overdue} tone="destructive" />
        <Stat label="Due Soon" value={dueSoon} tone="accent" />
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Koi pending follow-up nahi." />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {rows.map((r) => {
            const d = daysDiff(r.due_date);
            const tone = d > 7 ? "destructive" : d > 0 ? "accent" : "success";
            return (
              <li key={r.id} className="rounded-xl bg-surface border border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="font-semibold text-sm text-primary truncate">{r.patient?.name ?? "—"}</div>
                      {r.channel && (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                            r.channel === "CALL" ? "bg-primary/10 text-primary" : "bg-success/15 text-success",
                          )}
                        >
                          {r.channel === "CALL" ? "Call" : "WA"}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{r.patient?.primary_disease ?? r.followup_type ?? "—"}</div>
                    <div className={cn("text-[11px] font-semibold mt-1",
                      tone === "destructive" && "text-destructive",
                      tone === "accent" && "text-accent-foreground",
                      tone === "success" && "text-success")}>
                      {d > 0 ? `${d} din overdue` : d === 0 ? "Aaj due" : `${-d} din baaki`}
                    </div>
                    {r.patient_id && (
                      <button
                        onClick={() => setHistoryPatient({ id: r.patient_id, name: r.patient?.name ?? "—" })}
                        className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-primary underline"
                      >
                        <History className="h-3 w-3" /> History
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {r.patient?.mobile && (
                      <>
                        <a href={`tel:${r.patient.mobile}`} className="h-8 w-8 grid place-items-center rounded-full bg-primary text-primary-foreground">
                          <Phone className="h-4 w-4" />
                        </a>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={`https://wa.me/91${r.patient.mobile}?text=${encodeURIComponent(`Namaste ${r.patient.name} ji! Aapki follow-up due hai. Kripya clinic mein aaiye. — YHC Jaipur`)}`}
                          onClick={() => logWhatsAppInteraction({ patientId: r.patient_id }, "WhatsApp opened from Follow-up CRM")}
                          className="h-8 w-8 grid place-items-center rounded-full bg-success text-success-foreground"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      </>
                    )}
                    <button onClick={() => done(r.id)} className="h-8 w-8 grid place-items-center rounded-full bg-accent text-accent-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {historyPatient && (
        <InteractionHistoryModal
          patientId={historyPatient.id}
          name={historyPatient.name}
          onClose={() => setHistoryPatient(null)}
        />
      )}
    </MobileShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "primary" | "destructive" | "accent" }) {
  return (
    <div className="rounded-xl bg-surface border border-border px-2 py-2.5 text-center">
      <div className={cn("text-base font-bold",
        tone === "destructive" && "text-destructive",
        tone === "accent" && "text-accent-foreground",
        tone === "primary" && "text-primary")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
