import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate, ErrorBlock } from "@/components/yhc/AuthGate";
import { useEffect, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { searchPatients } from "@/lib/db";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Search Patients — YHC Jaipur" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="search">
      <SearchPage />
    </AuthGate>
  ),
});

function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<unknown>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      try {
        const rows = await searchPatients(term);
        if (!cancelled) {
          setResults(rows);
        }
      } catch (e) {
        // searchPatients throws on a real DB error — this used to have no
        // catch at all, so a failure left the page stuck on "Searching…"
        // forever with no error and no way to retry.
        if (!cancelled) setSearchError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, retryTick]);

  return (
    <MobileShell title="Search Patients" showBack>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          placeholder="Name, mobile or card number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-full bg-surface border border-input pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {!!searchError && (
        <ErrorBlock error={searchError} onRetry={() => setRetryTick((t) => t + 1)} />
      )}

      <ul className="mt-4 space-y-2">
        {q && !loading && !searchError && results.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-8">No matches.</li>
        )}
        {loading && (
          <li className="text-center text-sm text-muted-foreground py-8">Searching…</li>
        )}
        {results.map((p) => (
          <li key={p.id} className="rounded-xl bg-surface border border-border p-3">
            <Link
              to="/patient/$id"
              params={{ id: p.id }}
              className="flex items-center gap-3"
            >
              <div className="h-11 w-11 rounded-lg bg-primary text-primary-foreground grid place-items-center text-xs font-bold">
                {(p.name ?? "?").charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-sm text-primary">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.patient_code ?? p.id.slice(0, 8)} • {p.mobile}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {p.primary_disease ?? ""}
                </p>
              </div>
            </Link>
            {/* Direct follow-up hand-off (25 Sep 2026) — Dr. Yadav: patient
                mil jaane ke baad seedha follow-up/online follow-up banane
                ka koi tarika nahi tha, dubara Register/Call Desk pe jaake
                search karna padta tha. Follow-up reuses Register's existing
                mobile-prefill (same hand-off pattern as Appointments'
                "Arrived"); Online Follow-up reuses Call Desk's patientId
                hand-off. */}
            <div className="flex gap-1.5 mt-2.5">
              <Link
                to="/register"
                search={{ mobile: p.mobile ?? undefined, name: p.name ?? undefined, branch: p.branch ?? undefined }}
                className="flex-1 text-center rounded-lg bg-primary/10 text-primary text-[11px] font-bold py-1.5"
              >
                Follow-up
              </Link>
              <Link
                to="/call"
                search={{ patientId: p.id }}
                className="flex-1 text-center rounded-lg bg-accent/15 text-accent-foreground text-[11px] font-bold py-1.5"
              >
                Online Follow-up
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </MobileShell>
  );
}
