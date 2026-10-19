import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, PhoneCall, UserPlus, Search, X, History, BellOff, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { InteractionHistoryModal } from "@/components/yhc/InteractionHistoryModal";
import { cn } from "@/lib/utils";
import {
  fetchLeads, fetchLeadStats, fetchLeadSourceStats, searchLeads,
  updateLeadStage, setLeadQuality, setLeadDnd, assignLead, setLeadFollowup, logLeadCall,
  maskMobile, logWhatsAppInteraction, createLead, fetchStaff, searchPatients, fetchLeadSources,
  LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_SOURCE_CRITERIA, LEAD_STAGES, LEAD_STAGE_LABELS,
  LEAD_QUALITIES, LEAD_CALL_OUTCOMES,
  fetchLeadRepeatInfo, fetchLeadWhatsAppTemplates, buildLeadWhatsAppDraft, DISEASE_CATEGORY_LABELS, describeRepeatPattern,
  fetchWhatsAppControls, DEFAULT_WHATSAPP_CONTROLS,
  fetchLeadCategoryStats, fetchLeadsByCategory,
  type LeadStage, type LeadQuality, type LeadSource, type LeadRepeatInfo, type WhatsAppControls, type DiseaseCategory,
} from "@/lib/db";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "sonner";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "Lead CRM — YHC Jaipur" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER", "CALLING"]} permKey="leads">
      <LeadsPage />
    </AuthGate>
  ),
});

type Filter = "All" | "HOT" | "Follow-up Due" | "New Today" | "Dobara search";
const filters: Filter[] = ["All", "HOT", "Follow-up Due", "New Today", "Dobara search"];

// A later search than the one that created the lead (leads.last_enquired_at,
// migration 0089); a minute's slack absorbs same-second sheet duplicates.
function searchedAgain(l: { created_at: string; last_enquired_at?: string | null }): boolean {
  return !!l.last_enquired_at && new Date(l.last_enquired_at).getTime() - new Date(l.created_at).getTime() > 60_000;
}

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

// Exact date+time the enquiry came in (16 Oct 2026, Dr. Yadav: "agar
// samne wala puche to clear bata sake ki is time is date ko is bimari ke
// liye search kiya tha") — "3d ago" alone can't answer that, staff needs
// the real timestamp to read back to the patient.
function exactDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// Calendar days (device clock), not 24-hour blocks: a search last night
// is "Kal", not "Aaj".
function dayWord(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000,
  );
  if (diff === 0) return "Aaj";
  if (diff === 1) return "Kal";
  return shortDate(iso);
}

function ordinal(n: number): string {
  const label = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"][n - 1];
  return label ?? `${n}th`;
}

// Where this lead is in the WhatsApp flow — mirrors lead-flow-send /
// lead-touch-sequencer (welcome, then follow-ups 2/5/10 days after the
// welcome actually went out). Old leads that never got a welcome show
// nothing: the flow only runs for new leads.
const NUDGE_AFTER_DAYS: Record<number, number> = { 1: 2, 2: 5, 3: 10 };

function flowStatus(
  l: { auto_touch_count?: number; call_count?: number; dnd?: boolean; status?: string; created_at: string; last_inbound_at?: string | null; wa_welcome_sent_at?: string | null },
  controls: WhatsAppControls,
): string | null {
  if (l.status === "CONVERTED" || l.status === "LOST") return null;
  if (l.dnd) return "WhatsApp band (DND)";
  if (!l.wa_welcome_sent_at) {
    if (Date.now() - new Date(l.created_at).getTime() > 3 * 86_400_000) return null;
    return controls.masterEnabled ? "WhatsApp welcome abhi nahi gaya (template ON nahi hai?)" : "WhatsApp OFF hai — welcome nahi gaya";
  }
  if (l.last_inbound_at) return "WhatsApp: patient ne jawab diya — follow-ups band, aage team baat kare";
  if ((l.call_count ?? 0) > 0) return "WhatsApp follow-ups band (staff ne call kar diya)";
  const done = (l.auto_touch_count ?? 1) - 1;
  if (done >= 3) return "WhatsApp: welcome + 3 follow-up ho gaye, jawab nahi aaya";
  const next = new Date(new Date(l.wa_welcome_sent_at).getTime() + NUDGE_AFTER_DAYS[done + 1] * 86_400_000);
  const when = next.getTime() <= Date.now() ? "agla follow-up due hai" : `agla ~${next.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
  return `WhatsApp: welcome gaya${done ? ` + ${done} follow-up` : ""} • ${when}`;
}

const PAIN_FIELDS: [string, string][] = [["symptom", "Takleef"], ["duration", "Kab se"], ["treatment", "Ilaaj"], ["consult", "Milna"]];

function LeadsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["leads"], queryFn: fetchLeads });
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
      if (filter === "Dobara search") return searchedAgain(l);
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
  const stats = statsQ.data ?? { total: 0, repeatEnquiries: 0, totalEnquiries: 0, hot: 0, converted: 0, newToday: 0 };

  // TASK 5 — source analytics. Also COUNT-based, so it stays correct past
  // the 500-row display cap.
  const sourceQ = useQuery({ queryKey: ["lead-source-stats"], queryFn: fetchLeadSourceStats });
  const sourceRows = sourceQ.data ?? [];
  const [showSources, setShowSources] = useState(false);

  // Category (disease) breakdown — "kaunsi category humare liye sabse
  // jyada kaam kar rahi hai" (16 Oct 2026). Same shape as source-stats,
  // but also doubles as the filter: tapping a category row below sets
  // activeCategory, which switches the main list to fetchLeadsByCategory.
  const categoryQ = useQuery({ queryKey: ["lead-category-stats"], queryFn: fetchLeadCategoryStats });
  const categoryRows = categoryQ.data ?? [];
  const [showCategories, setShowCategories] = useState(false);
  const [activeCategory, setActiveCategory] = useState<DiseaseCategory | null>(null);
  const categoryLeadsQ = useQuery({
    queryKey: ["leads-by-category", activeCategory],
    queryFn: () => fetchLeadsByCategory(activeCategory!),
    enabled: activeCategory !== null,
  });

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

  const displayList = activeCategory ? (categoryLeadsQ.data?.rows ?? []) : isSearching ? (searchQ.data ?? []) : filtered;
  const displayLoading = activeCategory ? categoryLeadsQ.isLoading : isSearching ? searchQ.isLoading : isLoading;
  const [manageId, setManageId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // Repeat-enquiry flag — same mobile appearing more than once in the leads
  // table, whether for the same complaint re-asked or a different one each
  // time. Scoped to whatever's currently on screen (see fetchLeadRepeatInfo).
  const visibleMobiles = useMemo(() => displayList.map((l: any) => l.mobile).filter(Boolean), [displayList]);
  const repeatQ = useQuery({
    queryKey: ["lead-repeat-info", visibleMobiles.slice().sort().join(",")],
    queryFn: () => fetchLeadRepeatInfo(visibleMobiles),
    enabled: visibleMobiles.length > 0,
  });
  const repeatByMobile: Map<string, LeadRepeatInfo> = repeatQ.data ?? new Map();

  // WhatsApp message drafts — disease-category templates, Owner-editable
  // (Owner Control → Lead Messages). These only ever open a prefilled
  // WhatsApp chat for staff to review and send themselves — nothing here
  // sends automatically.
  const waTemplatesQ = useQuery({ queryKey: ["lead-wa-templates"], queryFn: fetchLeadWhatsAppTemplates });
  const waControlsQ = useQuery({ queryKey: ["whatsapp-controls"], queryFn: fetchWhatsAppControls });
  const waControls = waControlsQ.data ?? DEFAULT_WHATSAPP_CONTROLS;
  const [waDraftLead, setWaDraftLead] = useState<any | null>(null);

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
      {!waControls.masterEnabled && (
        <div className="mt-2 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-[11px] px-3 py-2.5 font-semibold">
          ⚠️ WhatsApp abhi OFF hai (Owner → WhatsApp se) — "Auto-sequence" waali lines sirf track kar rahi hain ki kaunsa touch due hai, koi message actually nahi ja raha.
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 mt-2">
        <StatCard
          label="Total Enquiries"
          value={stats.totalEnquiries}
          sub={`${stats.total.toLocaleString("en-IN")} log · ${stats.repeatEnquiries.toLocaleString("en-IN")} repeat`}
        />
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

      <button
        type="button"
        onClick={() => setShowCategories((v) => !v)}
        className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[11px] font-semibold text-primary text-left"
      >
        {showCategories ? "▾" : "▸"} Category-wise performance (kis disease ke liye sabse zyada leads)
      </button>
      {showCategories && (
        <div className="mt-2 rounded-xl border border-border bg-surface p-3">
          {categoryQ.isLoading ? (
            <div className="text-[11px] text-muted-foreground">Loading…</div>
          ) : categoryRows.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Abhi koi category data nahi hai.</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] uppercase tracking-wider text-muted-foreground px-1">
                <span>Category</span>
                <span className="text-right">Enquiries</span>
                <span className="text-right">Log</span>
                <span className="text-right">Converted</span>
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {categoryRows.map((r) => (
                  <li key={r.category}>
                    <button
                      onClick={() => { setActiveCategory(r.category); setShowCategories(false); setSearchTerm(""); }}
                      className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs items-center text-left hover:bg-muted/50 rounded-lg px-1 py-0.5"
                    >
                      <span className="font-semibold truncate">{r.label}</span>
                      <span className="text-right tabular-nums font-semibold">{r.enquiries.toLocaleString("en-IN")}</span>
                      <span className="text-right tabular-nums">{r.leads.toLocaleString("en-IN")}</span>
                      <span className="text-right tabular-nums text-success font-semibold">
                        {r.converted}{r.leads > 0 ? ` · ${Math.round((r.converted / r.leads) * 100)}%` : ""}
                      </span>
                    </button>
                  </li>
                ))}
                <li className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs items-center border-t border-border pt-1.5 px-1 font-bold">
                  <span>Total</span>
                  <span className="text-right tabular-nums">{categoryRows.reduce((s, r) => s + r.enquiries, 0).toLocaleString("en-IN")}</span>
                  <span className="text-right tabular-nums">{categoryRows.reduce((s, r) => s + r.leads, 0).toLocaleString("en-IN")}</span>
                  <span className="text-right tabular-nums text-success">{categoryRows.reduce((s, r) => s + r.converted, 0)}</span>
                </li>
              </ul>
              <p className="mt-2 text-[10px] text-muted-foreground">Enquiries = sheet ki har row (dobara search bhi gini gayi). Log = alag-alag log. Kisi category pe tap karke sirf wahi leads dekh sakte ho.</p>
            </>
          )}
        </div>
      )}

      {activeCategory && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-accent/15 border border-accent/30 px-3 py-2">
          <span className="text-[12px] font-semibold text-accent-foreground">
            Filter: {DISEASE_CATEGORY_LABELS[activeCategory]}
            {categoryLeadsQ.data?.truncated ? " (sirf latest 500)" : ""}
          </span>
          <button onClick={() => setActiveCategory(null)} className="text-[11px] font-semibold text-destructive underline">
            Hatao
          </button>
        </div>
      )}

      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); if (e.target.value) setActiveCategory(null); }}
          placeholder="Naam, mobile, ya source se search karo (poore 30k+ leads mein)"
          className="w-full rounded-xl border border-border bg-surface pl-9 pr-9 py-2.5 text-sm"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm("")} aria-label="Search clear karo" className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 grid place-items-center rounded-full bg-muted">
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
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : displayList.length === 0 ? (
        <EmptyBlock label={isSearching ? "Koi lead is naam/mobile se nahi mila." : "Koi lead nahi mila."} />
      ) : (
        <ul className="mt-3 space-y-2">
          {displayList.map((l) => {
            const quality = (l.lead_quality ?? "WARM") as LeadQuality;
            const stage = (l.status ?? "NEW") as LeadStage;
            const created = l.created_at;
            const again = searchedAgain(l);
            const days = mounted ? daysSince(again ? l.last_enquired_at : created) : 0;
            const sourceLabel = LEAD_SOURCE_LABELS[(l.lead_source ?? "OTHER") as LeadSource] ?? l.lead_source ?? "—";
            const assignedStaff = assignableStaff.find((u: any) => u.id === l.assigned_to);
            const isOpen = manageId === l.id;
            const closed = stage === "CONVERTED" || stage === "LOST";
            const repeat = repeatByMobile.get(l.mobile);
            const latest = repeat && repeat.count > 1 ? repeat.occurrences[repeat.occurrences.length - 1] : null;
            const pattern = repeat && repeat.count > 1 ? describeRepeatPattern(repeat.occurrences) : null;
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
                    {latest && (
                      <div className="mb-1 inline-flex max-w-full rounded-md bg-destructive text-destructive-foreground px-2 py-0.5 text-[10px] font-bold">
                        <span className="truncate">
                          🔁 {mounted ? `${dayWord(latest.date)} ${new Date(latest.date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}` : ""} dobara search
                          {latest.disease ? ` — "${latest.disease}"` : ""} · {ordinal(repeat!.count)} baar
                        </span>
                      </div>
                    )}
                    <div className="font-semibold text-sm truncate">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {maskMobile(l.mobile)} • {sourceLabel}
                      {l.disease_interest ? ` • ${l.disease_interest}` : ""}
                    </div>
                    <div className="text-[10px] text-primary font-semibold mt-0.5">
                      {latest ? "Pehli enquiry: " : ""}
                      {mounted ? exactDateTime(l.created_at) : "—"}{latest ? "" : " ko enquiry aayi"}
                      {l.disease_interest ? ` — "${l.disease_interest}" ke liye` : ""}
                    </div>
                    {l.notes && (
                      <div className="text-[11px] text-foreground/70 mt-1 truncate">"{l.notes}"</div>
                    )}
                    {l.last_inbound_text && (
                      <div className={cn(
                        "mt-1.5 rounded-lg border px-2 py-1.5 text-[11px]",
                        l.inbound_flag === "BOOKING_INTENT" ? "bg-success/10 border-success/30 text-success"
                          : l.inbound_flag === "NEEDS_HUMAN" ? "bg-destructive/10 border-destructive/30 text-destructive"
                          : "bg-accent/10 border-accent/30 text-accent-foreground",
                      )}>
                        <span className="font-bold">
                          {l.inbound_flag === "BOOKING_INTENT" ? "💬 Booking chahta hai — " : l.inbound_flag === "NEEDS_HUMAN" ? "💬 Reply aaya, human chahiye — " : "💬 Reply aaya — "}
                        </span>
                        "{l.last_inbound_text.slice(0, 120)}"
                      </div>
                    )}
                    {repeat && repeat.count > 1 && (
                      <div className="mt-1.5 rounded-lg bg-destructive/10 border border-destructive/30 px-2 py-1.5">
                        {pattern && (
                          <div className="text-[11px] text-foreground font-semibold leading-snug">
                            {pattern.kind === "SUSPICIOUS" || pattern.kind === "MANY_PROBLEMS" ? "⚠️ " : pattern.kind === "WANTS_HOMEOPATHY" || pattern.kind === "URGENT_SAME" ? "🎯 " : "💡 "}
                            {pattern.text}
                          </div>
                        )}
                        <div className="text-[10px] text-destructive font-bold mt-1">
                          🔁 Ye {ordinal(repeat.count)} baar search hui hai isi number se
                        </div>
                        <div className="text-[10px] text-destructive/90 mt-0.5 space-y-0.5">
                          {repeat.occurrences.map((o, i) => {
                            const n = repeat.occurrences.length;
                            const isLast = i === n - 1;
                            if (n > 6 && i > 0 && i < n - 4) {
                              return i === 1 ? <div key={i}>… beech me {n - 5} aur …</div> : null;
                            }
                            return (
                              <div key={i}>
                                {isLast ? "Ab" : ordinal(i + 1)} ({shortDate(o.date)}{new Date(o.date).getFullYear() !== new Date().getFullYear() ? ` ${String(new Date(o.date).getFullYear()).slice(2)}` : ""}): {o.disease || "—"}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {l.pain_profile && PAIN_FIELDS.some(([k]) => l.pain_profile[k]) && (
                      <div className="mt-1.5 rounded-lg bg-primary/5 border border-primary/20 px-2 py-1.5 text-[11px]">
                        <span className="font-bold text-primary">🩺 Pain profile (WhatsApp se): </span>
                        {PAIN_FIELDS.filter(([k]) => l.pain_profile[k]).map(([k, label]) => `${label}: ${l.pain_profile[k]}`).join(" · ")}
                        {l.pain_profile.typed && <div className="text-foreground/70 mt-0.5">Likha: "{String(l.pain_profile.typed).slice(0, 160)}"</div>}
                      </div>
                    )}
                    {mounted && flowStatus(l, waControls) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">{flowStatus(l, waControls)}</div>
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
                    {mounted ? (again ? `Dobara search: ${dayWord(l.last_enquired_at)}` : days === 0 ? "Enquired today" : `${days}d ago`) : "—"}
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
                    <button
                      onClick={() => setWaDraftLead(l)}
                      className="flex items-center justify-center gap-1 rounded-lg bg-accent text-accent-foreground py-2 text-xs font-semibold"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </button>
                    <button
                      disabled={convertingId !== null}
                      aria-label={`${l.name} ko patient mein convert karo`}
                      onClick={async () => {
                        if (convertingId) return;
                        setConvertingId(l.id);
                        try {
                          await doStage(l.id, "CONVERTED");
                          toast.success(`${l.name} converted → Register`);
                          navigate({ to: "/register", replace: true });
                        } catch (e) {
                          toast.error("Convert nahi ho paaya. Dobara try karein.");
                          setConvertingId(null);
                        }
                      }}
                      className="flex items-center justify-center gap-1 rounded-lg bg-primary text-primary-foreground py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> {convertingId === l.id ? "…" : "Convert"}
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
      {waDraftLead && waTemplatesQ.data && (
        <WhatsAppDraftModal
          lead={waDraftLead}
          templates={waTemplatesQ.data.templates}
          disclosure={waTemplatesQ.data.disclosure}
          onClose={() => setWaDraftLead(null)}
        />
      )}
    </MobileShell>
  );
}

// Disease-category draft, staff-reviewed before send — see the NCH/NMC note
// above buildLeadWhatsAppDraft in db.ts for why this is a prefilled-and-
// editable manual send, not an automated one. Opening wa.me with `text=`
// prefills the message in WhatsApp itself; staff still taps Send there.
function WhatsAppDraftModal({
  lead,
  templates,
  disclosure,
  onClose,
}: {
  lead: any;
  templates: Parameters<typeof buildLeadWhatsAppDraft>[1];
  disclosure: string;
  onClose: () => void;
}) {
  const draft = useMemo(() => buildLeadWhatsAppDraft(lead, templates, disclosure), [lead, templates, disclosure]);
  const [text, setText] = useState(draft.text);

  const openWhatsApp = () => {
    logWhatsAppInteraction({ leadId: lead.id }, `WhatsApp draft opened (${DISEASE_CATEGORY_LABELS[draft.category]}) from Lead CRM`);
    window.open(`https://wa.me/91${lead.mobile}?text=${encodeURIComponent(text)}`, "_blank");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-primary text-lg">WhatsApp Draft — {lead.name}</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="text-[11px] text-muted-foreground">
            Category: <span className="font-semibold text-primary">{DISEASE_CATEGORY_LABELS[draft.category]}</span> (disease interest se auto-pick hui)
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Ye WhatsApp mein khul jayega, message already bhara hoga — aap edit kar sakte ho, bhejna khud WhatsApp mein tap karna hoga. Kuch yahan se automatically nahi jaata.
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

function StatCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number;
  tone?: "destructive" | "success";
  sub?: string;
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
        {value.toLocaleString("en-IN")}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
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
// Exported (25 Sep 2026) so the unified Call Desk's "Inquiry" tile can
// open this exact same modal instead of duplicating the lead-capture form.
export function AddLeadModal({ staff, onClose, onAdded }: { staff: any[]; onClose: () => void; onAdded: () => void }) {
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
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
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
