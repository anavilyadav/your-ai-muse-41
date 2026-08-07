import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, PhoneCall, UserPlus, Search, X, History, BellOff, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { InteractionHistoryModal } from "@/components/yhc/InteractionHistoryModal";
import { cn } from "@/lib/utils";
import {
  fetchLeads, fetchLeadStats, fetchLeadSourceStats, searchLeads,
  updateLeadStage, setLeadQuality, setLeadDnd, assignLead, setLeadFollowup, logLeadCall,
  maskMobile, logWhatsAppInteraction, createLead, fetchStaff, searchPatients, fetchLeadSources,
  LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_SOURCE_CRITERIA, LEAD_STAGES, LEAD_STAGE_LABELS,
  LEAD_QUALITIES, LEAD_CALL_OUTCOMES,
  type LeadStage, type LeadQuality, type LeadSource,
} from "@/lib/db";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "sonner";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "Lead CRM — YHC Jaipur" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="leads">
      <LeadsPage />
    </AuthGate>
  ),
});

type Filter = "All" | "HOT" | "Follow-up Due" | "New Today";
const filters: Filter[] = ["All", "HOT", "Follow-up Due", "New Today"];

// FIXED 05 Aug: temperature (quality) and funnel stage are two different
// DB columns now — styled separately instead of one conflated enum.
const qualityStyle: Record<LeadQuality, string> = {
  HOT: "bg-destructive/15 text-destructive border-destructive/30",
  WARM: "bg-accent/25 text-accent-foreground border-accent/40",
  COLD: "bg-muted text-muted-foreground border-border",
};

const qualityBorder: Record<LeadQuality, string> = {
  HOT: "border-l-destructive",
  WARM: "border-l-accent",
  COLD: "border-l-muted-foreground/40",
};

const stageStyle: Record<LeadStage, string> = {
  NEW: "bg-muted text-muted-foreground border-border",
  CONTACTED: "bg-accent/20 text-accent-foreground border-accent/30",
  NURTURING: "bg-accent/25 text-accent-foreground border-accent/40",
  APPOINTMENT_FIXED: "bg-primary/15 text-primary border-primary/30",
  CONVERTED: "bg-success/20 text-success border-success/40",
  LOST: "bg-muted text-muted-foreground border-border line-through",
};

// Which stage a logged call outcome moves the lead to — keeps the funnel
// honest without staff having to separately remember to update it.
const OUTCOME_TO_STAGE: Record<(typeof LEAD_CALL_OUTCOMES)[number], LeadStage> = {
  "No Answer": "CONTACTED",
  "Interested": "NURTURING",
  "Not Interested": "LOST",
  "Callback Requested": "CONTACTED",
  "Booked": "APPOINTMENT_FIXED",
};

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function LeadsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["leads"], queryFn: fetchLeads });
  const leads = (data?.rows ?? []) as any[];
  const leadsTruncated = data?.truncated ?? false;
  const [filter, setFilter] = useState<Filter>("All");
  const [mounted, setMounted] = useState(false);
  const [historyLead, setHistoryLead] = useState<{ id: string; name: string } | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  useEffect(() => setMounted(true), []);
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const searchQ = useQuery({
    queryKey: ["leads-search", debouncedSearchTerm],
    queryFn: () => searchLeads(debouncedSearchTerm),
    enabled: debouncedSearchTerm.trim().length >= 2,
  });
  const isSearching = debouncedSearchTerm.trim().length >= 2;

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const quality = (l.lead_quality ?? "WARM") as LeadQuality;
      const stage = (l.status ?? "NEW") as LeadStage;
      const created = l.created_at;
      if (filter === "All") return true;
      if (filter === "HOT") return quality === "HOT";
      if (filter === "New Today") return daysSince(created) < 1;
      if (filter === "Follow-up Due") {
        // A real due-date takes priority (leads.next_followup); leads
        // without one fall back to the old "hot/warm and not touched
        // today" heuristic so nothing silently disappears from this tab.
        if (l.next_followup) return new Date(l.next_followup) <= new Date();
        return stage !== "CONVERTED" && stage !== "LOST" && (quality === "HOT" || quality === "WARM") && daysSince(created) >= 1;
      }
      return true;
    });
  }, [leads, filter]);

  // Real counts from the server — not derived from the (capped, most-
  // recent-500) `leads` list above, so these stay accurate no matter how
  // large the leads table is (30k+ imported leads would otherwise show
  // wildly wrong totals here, since the array itself is intentionally
  // bounded for performance).
  const statsQ = useQuery({ queryKey: ["lead-stats"], queryFn: fetchLeadStats });
  const stats = statsQ.data ?? { total: 0, hot: 0, converted: 0, newToday: 0 };

  // TASK 5 — source analytics. Also COUNT-based, so it stays correct past
  // the 500-row display cap.
  const sourceQ = useQuery({ queryKey: ["lead-source-stats"], queryFn: fetchLeadSourceStats });
  const sourceRows = sourceQ.data ?? [];
  const [showSources, setShowSources] = useState(false);

  const invalidateLeads = () => {
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["leads-search"] });
    qc.invalidateQueries({ queryKey: ["lead-stats"] });
    qc.invalidateQueries({ queryKey: ["lead-source-stats"] });
  };

  const doStage = async (id: string, s: LeadStage) => {
    try {
      await updateLeadStage(id, s);
      invalidateLeads();
    } catch (e: any) {
      toast.error("Stage update nahi hua: " + (e?.message ?? "unknown error"));
    }
  };

  const doQuality = async (id: string, q: LeadQuality) => {
    try {
      await setLeadQuality(id, q);
      invalidateLeads();
    } catch (e: any) {
      toast.error("Quality update nahi hua: " + (e?.message ?? "unknown error"));
    }
  };

  const doAssign = async (id: string, userId: string) => {
    const res = await assignLead(id, userId || null);
    if (!res.success) { toast.error("Assign nahi hua: " + res.error); return; }
    invalidateLeads();
  };

  const doFollowup = async (id: string, date: string) => {
    const res = await setLeadFollowup(id, date || null);
    if (!res.success) { toast.error("Follow-up date save nahi hua: " + res.error); return; }
    invalidateLeads();
  };

  const doLogCall = async (id: string, outcome: (typeof LEAD_CALL_OUTCOMES)[number]) => {
    const res = await logLeadCall(id, outcome);
    if (!res.success) { toast.error("Call log nahi hua: " + res.error); return; }
    await doStage(id, OUTCOME_TO_STAGE[outcome]);
    toast.success(`Call logged: ${outcome}`);
  };

  const doDnd = async (id: string, current: boolean) => {
    const res = await setLeadDnd(id, !current);
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    toast.success(!current ? "DND lagaya — ab isko message/call nahi jayega" : "DND hataya");
    invalidateLeads();
  };

  const staffQ = useQuery({ queryKey: ["staff-for-leads"], queryFn: fetchStaff });
  const assignableStaff = (staffQ.data ?? []).filter((u: any) => ["RECP1", "RECP2", "CALLING", "OWNER"].includes(u.role));

  const displayList = isSearching ? (searchQ.data ?? []) : filtered;
  const displayLoading = isSearching ? searchQ.isLoading : isLoading;
  const [manageId, setManageId] = useState<string | null>(null);

  return (
    <MobileShell
      title="Lead CRM"
      subtitle="Enquiries • Convert to patients"
      showBack
      right={
        <button
          onClick={() => setShowAddLead(true)}
          className="rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-3 py-1.5 inline-flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Add Lead
        </button>
      }
    >
      {showAddLead && (
        <AddLeadModal
          staff={assignableStaff}
          onClose={() => setShowAddLead(false)}
          onAdded={() => {
            qc.invalidateQueries({ queryKey: ["leads"] });
            qc.invalidateQueries({ queryKey: ["lead-stats"] });
            qc.invalidateQueries({ queryKey: ["lead-source-stats"] });
          }}
        />
      )}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Total Leads" value={stats.total} />
        <StatCard label="HOT" value={stats.hot} tone="destructive" />
        <StatCard label="Converted" value={stats.converted} tone="success" />
      </div>

      <button
        type="button"
        onClick={() => setShowSources((v) => !v)}
        className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[11px] font-semibold text-primary text-left"
      >
        {showSources ? "▾" : "▸"} Source-wise performance
      </button>
      {showSources && (
        <div className="mt-2 rounded-xl border border-border bg-surface p-3">
          {sourceQ.isLoading ? (
            <div className="text-[11px] text-muted-foreground">Loading…</div>
          ) : sourceRows.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Abhi koi source data nahi hai.</div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Source</span>
                <span className="text-right">Leads</span>
                <span className="text-right">Converted</span>
                <span className="text-right">Conv %</span>
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {sourceRows.map((r) => (
                  <li key={r.source} className="grid grid-cols-4 gap-2 text-xs items-center">
                    <span className="font-semibold truncate">{r.source}</span>
                    <span className="text-right tabular-nums">{r.leads}</span>
                    <span className="text-right tabular-nums text-success font-semibold">{r.converted}</span>
                    <span className="text-right tabular-nums">
                      {r.leads > 0 ? `${Math.round((r.converted / r.leads) * 100)}%` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[10px] text-muted-foreground">
                Registered patients by source: {sourceRows.map((r) => `${r.source} ${r.patients}`).join(" • ")}
              </div>
            </>
          )}
        </div>
      )}

      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Naam, mobile, ya source se search karo (poore 30k+ leads mein)"
          className="w-full rounded-xl border border-border bg-surface pl-9 pr-9 py-2.5 text-sm"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 grid place-items-center rounded-full bg-muted">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {!isSearching && (
        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-surface border-border text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      {!isSearching && leadsTruncated && (
        <div className="mt-2 text-[11px] text-muted-foreground text-center">
          Sirf latest 500 leads yahan dikh rahe hain — purana lead dhoondne ke liye upar search karo.
        </div>
      )}

      {displayLoading ? (
        <LoadingBlock />
      ) : displayList.length === 0 ? (
        <EmptyBlock label={isSearching ? "Koi lead is naam/mobile se nahi mila." : "Koi lead nahi mila."} />
      ) : (
        <ul className="mt-3 space-y-2">
          {displayList.map((l) => {
            const quality = (l.lead_quality ?? "WARM") as LeadQuality;
            const stage = (l.status ?? "NEW") as LeadStage;
            const created = l.created_at;
            const days = mounted ? daysSince(created) : 0;
            const sourceLabel = LEAD_SOURCE_LABELS[(l.lead_source ?? "OTHER") as LeadSource] ?? l.lead_source ?? "—";
            const assignedStaff = assignableStaff.find((u: any) => u.id === l.assigned_to);
            const isOpen = manageId === l.id;
            const closed = stage === "CONVERTED" || stage === "LOST";
            return (
              <li
                key={l.id}
                className={cn(
                  "rounded-xl bg-surface border border-border border-l-4 p-3 shadow-sm",
                  qualityBorder[quality],
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {maskMobile(l.mobile)} • {sourceLabel}
                      {l.disease_interest ? ` • ${l.disease_interest}` : ""}
                    </div>
                    {l.notes && (
                      <div className="text-[11px] text-foreground/70 mt-1 truncate">"{l.notes}"</div>
                    )}
                    {assignedStaff && (
                      <div className="text-[10px] text-primary mt-0.5">→ {assignedStaff.name}</div>
                    )}
                    {l.next_followup && (
                      <div className="text-[10px] text-accent-foreground mt-0.5">
                        Follow-up: {new Date(l.next_followup).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", qualityStyle[quality])}>
                      {quality}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-medium", stageStyle[stage])}>
                      {LEAD_STAGE_LABELS[stage]}
                    </span>
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    onClick={() => setHistoryLead({ id: l.id, name: l.name })}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary underline"
                  >
                    <History className="h-3 w-3" /> History
                  </button>
                  <button
                    onClick={() => doDnd(l.id, !!l.dnd)}
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-semibold underline",
                      l.dnd ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    <BellOff className="h-3 w-3" /> {l.dnd ? "DND ON" : "Mark DND"}
                  </button>
                  <button
                    onClick={() => setManageId(isOpen ? null : l.id)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground underline"
                  >
                    {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Manage
                  </button>
                  <span className="text-[10px] text-muted-foreground">
                    {mounted ? (days === 0 ? "Enquired today" : `${days}d ago`) : "—"}
                    {l.call_count > 0 ? ` • ${l.call_count} call${l.call_count > 1 ? "s" : ""}` : ""}
                  </span>
                </div>

                {isOpen && (
                  <div className="mt-2 rounded-lg bg-muted/40 border border-border p-2.5 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">Quality</label>
                      <select
                        value={quality}
                        onChange={(e) => doQuality(l.id, e.target.value as LeadQuality)}
                        className="w-full mt-0.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                      >
                        {LEAD_QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">Stage</label>
                      <select
                        value={stage}
                        onChange={(e) => doStage(l.id, e.target.value as LeadStage)}
                        className="w-full mt-0.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                      >
                        {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">Assign To</label>
                      <select
                        value={l.assigned_to ?? ""}
                        onChange={(e) => doAssign(l.id, e.target.value)}
                        className="w-full mt-0.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                      >
                        <option value="">— Unassigned —</option>
                        {assignableStaff.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">Follow-up date</label>
                      <input
                        type="date"
                        value={l.next_followup ?? ""}
                        onChange={(e) => doFollowup(l.id, e.target.value)}
                        className="w-full mt-0.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">Log call outcome</label>
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { doLogCall(l.id, e.target.value as any); e.target.value = ""; } }}
                        className="w-full mt-0.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                      >
                        <option value="">Kaisa raha call?</option>
                        {LEAD_CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {!closed && !l.dnd && (
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <a
                      href={`tel:${l.mobile}`}
                      onClick={() => stage === "NEW" && doStage(l.id, "CONTACTED")}
                      className="flex items-center justify-center gap-1 rounded-lg bg-success text-success-foreground py-2 text-xs font-semibold"
                    >
                      <PhoneCall className="h-3.5 w-3.5" /> Call
                    </a>
                    <a
                      href={`https://wa.me/91${l.mobile}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => logWhatsAppInteraction({ leadId: l.id }, "WhatsApp opened from Lead CRM")}
                      className="flex items-center justify-center gap-1 rounded-lg bg-accent text-accent-foreground py-2 text-xs font-semibold"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                    <button
                      onClick={async () => {
                        await doStage(l.id, "CONVERTED");
                        toast.success(`${l.name} converted → Register`);
                        navigate({ to: "/register", replace: true });
                      }}
                      className="flex items-center justify-center gap-1 rounded-lg bg-primary text-primary-foreground py-2 text-xs font-semibold"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Convert
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {historyLead && (
        <InteractionHistoryModal
          leadId={historyLead.id}
          name={historyLead.name}
          onClose={() => setHistoryLead(null)}
        />
      )}
    </MobileShell>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive" | "success";
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <div
        className={cn(
          "text-lg font-bold",
          tone === "destructive" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

// Phase 1 #12 — manual single-lead entry. Bulk Import already handles CSV
// files; this covers the one-off case (walk-in enquiry, a call that
// doesn't fit any automated source) without needing a whole file upload.
//
// UPGRADED 05 Aug — this is the "top-level" manual-add: source now uses the
// DB's real vocabulary (see LEAD_SOURCES fix), plus the per-source criteria
// fields (LEAD_SOURCE_CRITERIA) — disease interest for everyone, and a
// mandatory Referred-By patient link specifically when source = REFERRAL
// (a referral you can't trace back to the referring patient is useless for
// a thank-you follow-up later).
function AddLeadModal({ staff, onClose, onAdded }: { staff: any[]; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [source, setSource] = useState<string>("WALK_IN");
  const [diseaseInterest, setDiseaseInterest] = useState("");
  const [note, setNote] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  // Dynamic — includes the 9 built-in sources plus anything Owner has
  // added via Control Centre → Lead Sources → Add More (migration 0033).
  const sourcesQ = useQuery({ queryKey: ["lead-sources"], queryFn: fetchLeadSources });
  const sources = (sourcesQ.data ?? []).filter((s) => s.active);

  // Referred-By patient picker — only matters when source is REFERRAL.
  const [referredSearch, setReferredSearch] = useState("");
  const debouncedReferred = useDebouncedValue(referredSearch, 300);
  const [referredPatient, setReferredPatient] = useState<{ id: string; name: string; mobile: string } | null>(null);
  const referredQ = useQuery({
    queryKey: ["referred-patient-search", debouncedReferred],
    queryFn: () => searchPatients(debouncedReferred),
    enabled: source === "REFERRAL" && debouncedReferred.trim().length >= 2 && !referredPatient,
  });

  // Fixed per-source criteria text for the 9 built-in sources; anything
  // Owner adds later doesn't have hand-written criteria yet, so it gets an
  // honest generic note instead of a blank/broken lookup.
  const criteria = LEAD_SOURCE_CRITERIA[source as LeadSource] ?? {
    capture: "manual" as const,
    required: ["name", "mobile"],
    note: "Owner-added source — manual entry, no auto-capture wired for this yet.",
  };
  const canSubmit = name.trim() && mobile.length === 10 && (source !== "REFERRAL" || !!referredPatient);

  const submit = async () => {
    setSaving(true);
    const res = await createLead({
      name, mobile, source, note,
      diseaseInterest: diseaseInterest || undefined,
      referredByPatientId: referredPatient?.id,
      assignedTo: assignedTo || undefined,
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error ?? "Save nahi hua");
      return;
    }
    toast.success("Lead add ho gaya");
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-primary text-lg">Naya Lead</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Naam</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enquiry karne wale ka naam"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Mobile</label>
            <input
              inputMode="numeric"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10 digit mobile"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Source</label>
            {/* Fixed list on purpose — free text used to splinter into
                "jd" / "Just Dial" / "justdial ", which made source-wise
                reporting meaningless. */}
            <select
              value={source}
              onChange={(e) => { setSource(e.target.value); setReferredPatient(null); setReferredSearch(""); }}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            >
              {sources.map((src) => (
                <option key={src.code} value={src.code}>{src.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">{criteria.note}</p>
          </div>

          {source === "REFERRAL" && (
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Referred By (zaroori)</label>
              {referredPatient ? (
                <div className="mt-1 flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                  <span>{referredPatient.name} • {maskMobile(referredPatient.mobile)}</span>
                  <button onClick={() => setReferredPatient(null)} className="text-[10px] text-destructive font-semibold">Change</button>
                </div>
              ) : (
                <>
                  <input
                    value={referredSearch}
                    onChange={(e) => setReferredSearch(e.target.value)}
                    placeholder="Referring patient ka naam/mobile"
                    className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
                  />
                  {referredQ.data && referredQ.data.length > 0 && (
                    <ul className="mt-1 rounded-xl border border-border bg-surface divide-y divide-border max-h-36 overflow-y-auto">
                      {referredQ.data.map((p: any) => (
                        <li key={p.id}>
                          <button
                            onClick={() => setReferredPatient({ id: p.id, name: p.name, mobile: p.mobile })}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted"
                          >
                            {p.name} • {maskMobile(p.mobile)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Disease / Interest (optional)</label>
            <input
              value={diseaseInterest}
              onChange={(e) => setDiseaseInterest(e.target.value)}
              placeholder="e.g. Psoriasis, Migraine, Hair Fall"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
          {staff.length > 0 && (
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Assign To (optional)</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              >
                <option value="">— Unassigned —</option>
                {staff.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Kya poocha, koi context"
              rows={2}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
          <button
            onClick={submit}
            disabled={saving || !canSubmit}
            className="w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Lead Add Karo"}
          </button>
        </div>
      </div>
    </div>
  );
}
