import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, AlertTriangle } from "lucide-react";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { RoleShell } from "@/components/yhc/RoleShell";
import { fetchPatientsPage, fetchPatientsTotalCount, formatCardNumber, computeLocalDataQualityFlags } from "@/lib/db";

// Compact inline labels for the list — same underlying flags as
// DataQualityBanner's fuller Hinglish sentences, shortened to fit one
// line per patient row without wrapping the whole card.
const FLAG_LABELS: Record<string, string> = {
  incompleteName: "Naam adhoora",
  missingMobile: "Mobile nahi hai",
  missingCard: "Card nahi hai",
  partialCard: "Card adhoora",
  unconfirmedNumber: "Number unconfirmed",
};

export const Route = createFileRoute("/owner/patients")({
  head: () => ({ meta: [{ title: "Master Patient List — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <PatientsPage />
    </AuthGate>
  ),
});

const PAGE_SIZE = 50;

function PatientsPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
      setVisibleCount(PAGE_SIZE);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const list = useQuery({
    queryKey: ["owner-patients-list", debouncedQ, visibleCount],
    queryFn: () => fetchPatientsPage(visibleCount, debouncedQ || undefined),
  });

  // Deliberately its own query, independent of search/page state (Dr.
  // Yadav: "total patients hamesha dikhne chahiye top pe") — the number
  // at the top must stay the true grand total even while filtering.
  const totalQ = useQuery({
    queryKey: ["owner-patients-total"],
    queryFn: fetchPatientsTotalCount,
    staleTime: 60_000,
  });

  const rows = list.data?.rows ?? [];
  const hasMore = list.data?.hasMore ?? false;

  return (
    <RoleShell
      wide
      title="Master Patient List"
      subtitle="Sabhi registered patients — sirf Owner ko dikhta hai"
      showBack
      right={
        <Link
          to="/owner/card-index"
          className="rounded-full bg-white/15 text-primary-foreground text-[11px] px-3 py-1.5 font-semibold"
        >
          Card Index
        </Link>
      }
    >
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 mb-3">
        <div className="text-[11px] uppercase tracking-wider opacity-70">Total Patients</div>
        <div className="text-2xl font-bold mt-0.5">
          {totalQ.isLoading ? "…" : totalQ.isError ? "—" : (totalQ.data ?? 0).toLocaleString("en-IN")}
        </div>
      </div>

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          placeholder="Naam, mobile ya card number se filter karo"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-full bg-surface border border-input pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground px-1">
        {list.isLoading ? "Load ho raha hai…" : `${rows.length}${hasMore ? "+" : ""} patient${rows.length === 1 ? "" : "s"} dikh rahe hain`}
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.length === 0 && (
            <li className="text-center text-sm text-muted-foreground py-8">Koi patient nahi mila.</li>
          )}
          {rows.map((p) => {
            // Clear per-patient flag (25 Sep 2026, Dr. Yadav: "clearly
            // flag bhi karna chaiye ki patient ki poori profile me kya
            // kaam hai... wahi se change kar saku") — same local checks
            // DataQualityBanner uses on a patient's own record, computed
            // straight off this already-fetched row (no per-row query),
            // so every visible patient's gaps are legible while just
            // scanning/searching this list. Tapping the row already opens
            // the profile, where the fix actually happens.
            const flags = computeLocalDataQualityFlags(p);
            return (
            <li key={p.id}>
              <Link
                to="/patient/$id"
                params={{ id: p.id }}
                className="rounded-xl bg-surface border border-border p-3 flex items-center gap-3"
              >
                <div className="h-11 w-11 shrink-0 rounded-lg bg-primary text-primary-foreground grid place-items-center text-xs font-bold">
                  {(p.name ?? "?").charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-sm text-primary">{p.name}</p>
                  {/* Was falling back to patient_code (e.g. "YHC-22035")
                      whenever a real card number was missing — that's an
                      internal system ID, not a card, and looked like one
                      in this exact spot. 141 of 5185 real patients have no
                      card recorded at all (never issued one, or import
                      gap). Found live 22 Sep 2026: Owner reported "card
                      number" showing something that wasn't a card and
                      wasn't useful. Now says so plainly instead of
                      silently substituting a different kind of ID. */}
                  <p className="truncate text-xs text-muted-foreground">
                    {(() => {
                      const card = formatCardNumber(p.card_series, p.card_register, p.card_number);
                      return card ? `Card: ${card}` : "Card nahi hai";
                    })()} • {p.mobile || "Mobile nahi hai"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {p.lifetime_visits} visit{p.lifetime_visits === 1 ? "" : "s"}
                    {p.last_visit_date ? ` • Last: ${p.last_visit_date}` : ""}
                  </p>
                  {flags.hasAny && (
                    <p className="truncate text-[11px] font-semibold text-destructive mt-0.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {Object.entries(FLAG_LABELS).filter(([k]) => (flags as any)[k]).map(([, label]) => label).join(" • ")}
                    </p>
                  )}
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}

      {hasMore && !list.isLoading && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="mt-3 w-full rounded-full bg-surface border border-border py-2.5 text-sm font-semibold text-primary"
        >
          Aur load karo
        </button>
      )}
    </RoleShell>
  );
}
