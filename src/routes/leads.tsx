import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, PhoneCall, UserPlus, Search, X, History, BellOff } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { InteractionHistoryModal } from "@/components/yhc/InteractionHistoryModal";
import { cn } from "@/lib/utils";
import { fetchLeads, fetchLeadStats, searchLeads, updateLeadStatus, setLeadDnd, maskMobile, logWhatsAppInteraction, type LeadStatus } from "@/lib/db";
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

const statusStyle: Record<LeadStatus, string> = {
  HOT: "bg-destructive/15 text-destructive border-destructive/30",
  Warm: "bg-accent/25 text-accent-foreground border-accent/40",
  Cold: "bg-muted text-muted-foreground border-border",
  Converted: "bg-success/20 text-success border-success/40",
  Lost: "bg-muted text-muted-foreground border-border line-through",
};

const borderStyle: Record<LeadStatus, string> = {
  HOT: "border-l-destructive",
  Warm: "border-l-accent",
  Cold: "border-l-muted-foreground/40",
  Converted: "border-l-success",
  Lost: "border-l-muted-foreground/30",
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
      const status = (l.status ?? "Cold") as LeadStatus;
      const created = l.created_at ?? l.enquired_at;
      if (filter === "All") return true;
      if (filter === "HOT") return status === "HOT";
      if (filter === "New Today") return daysSince(created) < 1;
      if (filter === "Follow-up Due")
        return (status === "HOT" || status === "Warm") && daysSince(created) >= 1;
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

  const doUpdate = async (id: string, s: LeadStatus) => {
    try {
      await updateLeadStatus(id, s);
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads-search"] });
      qc.invalidateQueries({ queryKey: ["lead-stats"] });
    } catch (e: any) {
      toast.error("Status update nahi hua: " + (e?.message ?? "unknown error"));
    }
  };

  const doDnd = async (id: string, current: boolean) => {
    const res = await setLeadDnd(id, !current);
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    toast.success(!current ? "DND lagaya — ab isko message/call nahi jayega" : "DND hataya");
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["leads-search"] });
  };

  const displayList = isSearching ? (searchQ.data ?? []) : filtered;
  const displayLoading = isSearching ? searchQ.isLoading : isLoading;

  return (
    <MobileShell title="Lead CRM" subtitle="Enquiries • Convert to patients" showBack>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Total Leads" value={stats.total} />
        <StatCard label="HOT" value={stats.hot} tone="destructive" />
        <StatCard label="Converted" value={stats.converted} tone="success" />
      </div>

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
            const status = (l.status ?? "Cold") as LeadStatus;
            const created = l.created_at ?? l.enquired_at;
            const days = mounted ? daysSince(created) : 0;
            return (
              <li
                key={l.id}
                className={cn(
                  "rounded-xl bg-surface border border-border border-l-4 p-3 shadow-sm",
                  borderStyle[status],
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {maskMobile(l.mobile)} • {l.source ?? "—"}
                    </div>
                    {l.note && (
                      <div className="text-[11px] text-foreground/70 mt-1 truncate">
                        "{l.note}"
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      statusStyle[status],
                    )}
                  >
                    {status}
                  </span>
                </div>
                <button
                  onClick={() => setHistoryLead({ id: l.id, name: l.name })}
                  className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-primary underline"
                >
                  <History className="h-3 w-3" /> History
                </button>
                <button
                  onClick={() => doDnd(l.id, !!l.dnd)}
                  className={cn(
                    "mt-1.5 ml-3 inline-flex items-center gap-1 text-[10px] font-semibold underline",
                    l.dnd ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  <BellOff className="h-3 w-3" /> {l.dnd ? "DND ON" : "Mark DND"}
                </button>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {mounted ? (days === 0 ? "Enquired today" : `${days}d ago`) : "—"}
                </div>

                {status !== "Converted" && status !== "Lost" && !l.dnd && (
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <a
                      href={`tel:${l.mobile}`}
                      onClick={() => doUpdate(l.id, status === "Cold" ? "Warm" : status)}
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
                        await doUpdate(l.id, "Converted");
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
