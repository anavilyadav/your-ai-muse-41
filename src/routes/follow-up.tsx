import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, MessageCircle, CheckCircle2, History, TrendingUp, TrendingDown, ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { InteractionHistoryModal } from "@/components/yhc/InteractionHistoryModal";
import { useAuth } from "@/lib/auth";
import {
  fetchFollowups, fetchFollowupRevenueForecast, markFollowupDone, reopenFollowup, logWhatsAppInteraction,
  fetchStaff, FOLLOWUP_CALL_OUTCOMES, logFollowupCall,
  fetchFollowupWhatsAppTemplates, buildFollowupWhatsAppDraft,
} from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/follow-up")({
  head: () => ({ meta: [{ title: "Follow-up Calls — YHC" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER", "CALLING"]} permKey="followup">
      <FollowUpPage />
    </AuthGate>
  ),
});

function FollowUpPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["followups"], queryFn: fetchFollowups });
  const rows = (data?.rows ?? []) as any[];
  const total = data?.total ?? rows.length;
  const overdueTotal = data?.overdueTotal ?? 0;
  const [historyPatient, setHistoryPatient] = useState<{ id: string; name: string } | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [waDraftRow, setWaDraftRow] = useState<any | null>(null);
  const staffQ = useQuery({ queryKey: ["staff-for-followup"], queryFn: fetchStaff });
  const staffById = new Map((staffQ.data ?? []).map((u: any) => [u.id, u.name]));
  const waTemplatesQ = useQuery({ queryKey: ["followup-wa-templates"], queryFn: fetchFollowupWhatsAppTemplates });

  const logOutcome = async (row: any, outcome: (typeof FOLLOWUP_CALL_OUTCOMES)[number]) => {
    const res = await logFollowupCall(row.id, outcome, user?.id ?? null);
    if (!res.success) { toast.error("Outcome save nahi hua: " + res.error); return; }
    toast.success(`Outcome logged: ${outcome}`);
    qc.invalidateQueries({ queryKey: ["followups"] });
  };

  // Expected revenue forecast (25 Sep 2026, Dr. Yadav: "agar ye follow-ups
  // aaye to itna revenue, agar nahi aaye to itna loss") — its own query
  // (the RPC's exact totals, not derived from `rows` above, which is
  // capped) so the two numbers stay trustworthy even past 5,000 pending
  // follow-ups.
  const forecastQ = useQuery({ queryKey: ["followup-revenue-forecast"], queryFn: fetchFollowupRevenueForecast });
  const forecast = forecastQ.data;

  const today = new Date().toISOString().slice(0, 10);
  const daysDiff = (d: string) => Math.floor((Date.parse(today) - Date.parse(d)) / 86_400_000);

  const done = async (row: any) => {
    try {
      await markFollowupDone(row.id);
      qc.invalidateQueries({ queryKey: ["followups"] });
      toast.success(`${row.patient?.name ?? "Follow-up"} — done mark ho gaya`, {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await reopenFollowup(row.id);
              qc.invalidateQueries({ queryKey: ["followups"] });
              toast.success("Undo ho gaya — wapas pending mein hai");
            } catch (e: any) {
              toast.error("Undo nahi hua: " + (e?.message ?? "unknown error"));
            }
          },
        },
      });
    } catch (e: any) {
      toast.error("Update nahi hua: " + (e?.message ?? "unknown error"));
    }
  };

  // These two are TRUE counts from the DB (see fetchFollowups), not
  // derived from the capped `rows` array below — with a real backlog in
  // the thousands (e.g. after a historical follow-up backfill), computing
  // "Due"/"Overdue" from only the first 200 fetched rows silently showed
  // a number 40x smaller than reality, with nothing indicating it was
  // capped. Found live 22 Sep 2026.
  const dueSoonTotal = total - overdueTotal;

  return (
    <MobileShell title="Follow-up Calls" subtitle="Today" showBack>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Due" value={total} tone="primary" />
        <Stat label="Overdue" value={overdueTotal} tone="destructive" />
        <Stat label="Due Soon" value={dueSoonTotal} tone="accent" />
      </div>

      {/* Expected revenue forecast (25 Sep 2026) — "Rohit 30 din ki dawai
          lekar gaya, 2500 diye, ek mahine baad aayega to 2500 honge... agar
          nahi aaya to itna loss." Same amount basis for both cards — each
          pending follow-up's own originating-visit payment total. */}
      {forecast && (forecast.dueSoonAmount > 0 || forecast.overdueAmount > 0) && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-xl bg-success/10 border border-success/30 p-3">
            <div className="flex items-center gap-1 text-success">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wide font-bold">Expected Revenue</span>
            </div>
            <div className="text-lg font-bold text-success mt-0.5">₹{forecast.dueSoonAmount.toLocaleString("en-IN")}</div>
            <div className="text-[10px] text-muted-foreground">{forecast.dueSoonCount} follow-ups aane baaki</div>
          </div>
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3">
            <div className="flex items-center gap-1 text-destructive">
              <TrendingDown className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wide font-bold">Miss Ho Gaya (Loss)</span>
            </div>
            <div className="text-lg font-bold text-destructive mt-0.5">₹{forecast.overdueAmount.toLocaleString("en-IN")}</div>
            <div className="text-[10px] text-muted-foreground">{forecast.overdueCount} follow-ups wapas nahi aaye</div>
          </div>
        </div>
      )}

      {total > rows.length && (
        <div className="mt-2 rounded-lg bg-accent/15 text-accent-foreground text-[11px] px-3 py-2">
          {rows.length} sabse purani/jaldi wali dikh rahi hain (list mein) — baaki {total - rows.length} bhi pending hain, list neeche karte jao ya ek-ek "Done" karte jaao taaki agli batch dikhe.
        </div>
      )}

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
            const isOpen = manageId === r.id;
            const calledByName = r.called_by ? staffById.get(r.called_by) : null;
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
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className={cn("text-[11px] font-semibold",
                        tone === "destructive" && "text-destructive",
                        tone === "accent" && "text-accent-foreground",
                        tone === "success" && "text-success")}>
                        {d > 0 ? `${d} din overdue` : d === 0 ? "Aaj due" : `${-d} din baaki`}
                      </div>
                      {r.expectedAmount > 0 && (
                        <span className="text-[11px] font-semibold text-muted-foreground">• ₹{Number(r.expectedAmount).toLocaleString("en-IN")}</span>
                      )}
                    </div>
                    {r.outcome && (
                      <div className="text-[10px] text-accent-foreground mt-1">
                        Last outcome: <span className="font-semibold">{r.outcome}</span>{calledByName ? ` — ${calledByName}` : ""}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {r.patient_id && (
                        <button
                          onClick={() => setHistoryPatient({ id: r.patient_id, name: r.patient?.name ?? "—" })}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary underline"
                        >
                          <History className="h-3 w-3" /> History
                        </button>
                      )}
                      <button
                        onClick={() => setManageId(isOpen ? null : r.id)}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground underline"
                      >
                        {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Outcome log karo
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {r.patient?.mobile && (
                      <>
                        <a href={`tel:${r.patient.mobile}`} className="h-8 w-8 grid place-items-center rounded-full bg-primary text-primary-foreground">
                          <Phone className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => setWaDraftRow(r)}
                          className="h-8 w-8 grid place-items-center rounded-full bg-success text-success-foreground"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <button onClick={() => done(r)} className="h-8 w-8 grid place-items-center rounded-full bg-accent text-accent-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-2.5 rounded-lg bg-muted/40 border border-border p-2.5">
                    <label className="text-[9px] font-bold text-muted-foreground uppercase">Call/WhatsApp ka outcome</label>
                    <select
                      defaultValue=""
                      onChange={(e) => { if (e.target.value) { logOutcome(r, e.target.value as any); setManageId(null); e.target.value = ""; } }}
                      className="w-full mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                    >
                      <option value="">Kaisa raha?</option>
                      {FOLLOWUP_CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                )}
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
      {waDraftRow && waTemplatesQ.data && (
        <FollowupWhatsAppDraftModal
          row={waDraftRow}
          templates={waTemplatesQ.data.templates}
          disclosure={waTemplatesQ.data.disclosure}
          onClose={() => setWaDraftRow(null)}
        />
      )}
    </MobileShell>
  );
}

// Disease-specific draft, staff-reviewed before send — same pattern as
// Lead CRM's WhatsAppDraftModal (leads.tsx), same reasoning: prefilled
// into WhatsApp itself, staff taps Send there, nothing auto-sends.
function FollowupWhatsAppDraftModal({
  row,
  templates,
  disclosure,
  onClose,
}: {
  row: any;
  templates: Parameters<typeof buildFollowupWhatsAppDraft>[1];
  disclosure: string;
  onClose: () => void;
}) {
  const patient = { name: row.patient?.name ?? "", primary_disease: row.patient?.primary_disease };
  const draft = useMemo(() => buildFollowupWhatsAppDraft(patient, templates, disclosure), [row.id, templates, disclosure]);
  const [text, setText] = useState(draft.text);

  const openWhatsApp = () => {
    logWhatsAppInteraction({ patientId: row.patient_id }, `WhatsApp draft opened (${draft.category}) from Follow-up CRM`);
    window.open(`https://wa.me/91${row.patient.mobile}?text=${encodeURIComponent(text)}`, "_blank");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-primary text-lg">WhatsApp Draft — {patient.name}</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Ye WhatsApp mein khul jayega, message already bhara hoga — aap edit kar sakte ho, bhejna khud WhatsApp mein tap karna hoga.
          </p>
          <button
            onClick={openWhatsApp}
            className="w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm inline-flex items-center justify-center gap-2"
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp Mein Kholo
          </button>
        </div>
      </div>
    </div>
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
