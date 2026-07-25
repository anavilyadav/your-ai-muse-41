import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate } from "@/components/yhc/AuthGate";
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

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const rows = await searchPatients(term);
      if (!cancelled) {
        setResults(rows);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <MobileShell title="Search Patients" showBack>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          placeholder="Name, mobile or YHC-ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-full bg-surface border border-input pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <ul className="mt-4 space-y-2">
        {q && !loading && results.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-8">No matches.</li>
        )}
        {loading && (
          <li className="text-center text-sm text-muted-foreground py-8">Searching…</li>
        )}
        {results.map((p) => (
          <li key={p.id}>
            <Link
              to="/patient/$id"
              params={{ id: p.id }}
              className="rounded-xl bg-surface border border-border p-3 flex items-center gap-3"
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
          </li>
        ))}
      </ul>
    </MobileShell>
  );
}
