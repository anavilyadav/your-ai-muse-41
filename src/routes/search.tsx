import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { usePatients } from "@/lib/yhc-store";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Search Patients — YHC Jaipur" }] }),
  component: SearchPage,
});

function SearchPage() {
  const patients = usePatients();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const results = query
    ? patients.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.mobile.includes(query) ||
          p.id.toLowerCase().includes(query) ||
          p.token.toLowerCase().includes(query),
      )
    : [];

  return (
    <MobileShell title="Search Patients" showBack>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          placeholder="Name, mobile, YHC-ID or token"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-full bg-surface border border-input pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <ul className="mt-4 space-y-2">
        {query && results.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-8">No matches.</li>
        )}
        {results.map((p) => (
          <li key={p.id} className="rounded-xl bg-surface border border-border p-3 flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-primary text-primary-foreground grid place-items-center text-xs font-bold">
              {p.token}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-sm text-primary">{p.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {p.id} • {p.mobile}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{p.chiefComplaint}</p>
            </div>
          </li>
        ))}
      </ul>
    </MobileShell>
  );
}
