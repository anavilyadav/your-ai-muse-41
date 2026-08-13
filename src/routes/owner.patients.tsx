import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { RoleShell } from "@/components/yhc/RoleShell";
import { fetchPatientsPage, formatCardNumber } from "@/lib/db";

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

  const rows = list.data?.rows ?? [];
  const hasMore = list.data?.hasMore ?? false;

  return (
    <RoleShell wide title="Master Patient List" subtitle="Sabhi registered patients — sirf Owner ko dikhta hai" showBack>
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
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.length === 0 && (
            <li className="text-center text-sm text-muted-foreground py-8">Koi patient nahi mila.</li>
          )}
          {rows.map((p) => (
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
                  <p className="truncate text-xs text-muted-foreground">
                    {formatCardNumber(p.card_series, p.card_register, p.card_number) ?? p.patient_code ?? "—"} • {p.mobile}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {p.lifetime_visits} visit{p.lifetime_visits === 1 ? "" : "s"}
                    {p.last_visit_date ? ` • Last: ${p.last_visit_date}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
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
