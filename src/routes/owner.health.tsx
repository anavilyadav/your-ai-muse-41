import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RoleShell, Badge } from "@/components/yhc/RoleShell";
import { runHealthChecks, fetchStockIssues } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/health")({
  head: () => ({ meta: [{ title: "System Health — Owner" }, { name: "robots", content: "noindex" }] }),
  component: HealthPage,
});

type Result = { label: string; ok: boolean; detail: string };

function HealthPage() {
  const [results, setResults] = useState<Result[] | null>(null);
  const [running, setRunning] = useState(false);
  const issues = useQuery({ queryKey: ["stock-issues"], queryFn: () => fetchStockIssues() });

  const run = async () => {
    setRunning(true);
    const r = await runHealthChecks();
    setResults(r);
    setRunning(false);
    const failCount = r.filter((x) => !x.ok).length;
    if (failCount === 0) toast.success("Sab checks pass ho gaye");
    else toast.error(`${failCount} check(s) fail hue`);
  };

  const okCount = results?.filter((h) => h.ok).length ?? 0;
  const failCount = (results?.length ?? 0) - okCount;

  return (
    <RoleShell title="System Health" subtitle="Live Supabase checks" showBack>
      {!results ? (
        <div className="rounded-2xl bg-surface border border-border p-6 text-center">
          <div className="text-sm text-muted-foreground">"Run Health Check Now" dabao — real Supabase connectivity aur table counts check karega</div>
        </div>
      ) : (
        <>
          <div className={cn("rounded-2xl p-5 text-center", failCount === 0 ? "bg-success/10" : "bg-destructive/10")}>
            <div className="text-3xl">{failCount === 0 ? "✓" : "⚠"}</div>
            <div className={cn("text-[17px] font-extrabold mt-1", failCount === 0 ? "text-success" : "text-destructive")}>
              {failCount === 0 ? "System Healthy" : "Issues Found"}
            </div>
            <div className="text-[12px] text-muted-foreground mt-0.5">{okCount} OK • {failCount} failing</div>
          </div>
          <ul className="mt-3 space-y-2">
            {results.map((h, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-2xl bg-surface border border-border border-l-[4px] p-3.5 flex justify-between items-center gap-3",
                  h.ok ? "border-l-success" : "border-l-destructive",
                )}
              >
                <div className="min-w-0">
                  <div className="text-sm text-primary font-semibold">{h.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{h.detail}</div>
                </div>
                <Badge tone={h.ok ? "success" : "destructive"}>{h.ok ? "✓ OK" : "✗ Fail"}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
      {issues.data && issues.data.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Recent Stock Issues (Pharmacy)
          </div>
          <ul className="space-y-2">
            {issues.data.map((i: any) => (
              <li key={i.id} className="rounded-xl bg-destructive/10 border border-destructive/30 p-3">
                <div className="text-[13px] text-primary">{i.new_value}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {i.created_at ? new Date(i.created_at).toLocaleString("en-IN") : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        onClick={run}
        disabled={running}
        className="mt-4 w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm disabled:opacity-50"
      >
        {running ? "Running…" : "Run Health Check Now"}
      </button>
    </RoleShell>
  );
}
