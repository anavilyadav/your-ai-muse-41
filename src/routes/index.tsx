import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchTodayQueue, branchLabel, statusLabel } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today's Queue — YHC Jaipur" },
      { name: "description", content: "Reception queue for Yadav Homeo Clinic Jaipur." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QueuePageGated,
});

function QueuePageGated() {
  return (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]}>
      <QueuePage />
    </AuthGate>
  );
}

const filters = ["All", "Waiting", "Consultation", "Pharmacy", "Done"] as const;
type Filter = (typeof filters)[number];

const statusStyles: Record<string, string> = {
  Waiting: "bg-accent/25 text-accent-foreground border-accent/60",
  "Case Taking": "bg-accent/25 text-accent-foreground border-accent/60",
  Prescribed: "bg-success/20 text-success border-success/50",
  Pharmacy: "bg-accent/25 text-accent-foreground border-accent/60",
  "Pay Due": "bg-destructive/15 text-destructive border-destructive/40",
  Done: "bg-muted text-muted-foreground border-border",
};

function QueuePage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("All");
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["today-queue"],
    queryFn: fetchTodayQueue,
    refetchInterval: 15_000,
  });

  const rows = data ?? [];
  const stats = useMemo(() => {
    const waiting = rows.filter((r) => ["REGISTERED", "WAITING", "CASE_TAKING", "WAITING_DOCTOR"].includes(r.visit_status)).length;
    const done = rows.filter((r) => r.visit_status === "DONE").length;
    return { total: rows.length, waiting, done };
  }, [rows]);

  const filtered = rows.filter((r) => {
    const s = statusLabel(r.visit_status);
    if (filter === "All") return true;
    if (filter === "Waiting") return s === "Waiting" || s === "Case Taking";
    if (filter === "Consultation") return s === "Prescribed";
    if (filter === "Pharmacy") return s === "Pharmacy" || s === "Pay Due";
    if (filter === "Done") return s === "Done";
    return true;
  });

  return (
    <MobileShell
      title="Yadav Homeo Clinic"
      subtitle={today ? `Jaipur • ${today}` : "Jaipur"}
      right={
        <Link
          to="/register"
          className="h-9 px-3 rounded-full bg-accent text-accent-foreground text-xs font-bold inline-flex items-center gap-1 shadow-sm"
        >
          <Plus className="h-4 w-4" /> New
        </Link>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Total", value: stats.total, tone: "primary" },
          { label: "Waiting", value: stats.waiting, tone: "accent" },
          { label: "Done", value: stats.done, tone: "success" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-surface border border-border px-2 py-2.5 text-center">
            <div
              className={cn(
                "text-base font-bold leading-tight",
                s.tone === "success" && "text-success",
                s.tone === "accent" && "text-accent-foreground",
                s.tone === "primary" && "text-primary",
              )}
            >
              {s.value}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {filters.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition",
                active ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-foreground border-border",
              )}
            >
              {f}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <LoadingBlock label="Queue load ho rahi hai…" />
      ) : filtered.length === 0 ? (
        <EmptyBlock label="Aaj koi patient nahi mila." />
      ) : (
        <ul className="mt-3 space-y-2">
          {filtered.map((r) => {
            const s = statusLabel(r.visit_status);
            const due = Number(r.patient?.current_balance ?? 0);
            return (
              <li key={r.id}>
                <button
                  onClick={() => navigate({ to: "/pay/$id", params: { id: r.id } })}
                  className="w-full text-left rounded-xl bg-surface border border-border p-3 flex items-center gap-3 shadow-sm hover:border-primary/40 active:scale-[0.99] transition"
                >
                  <div className="shrink-0 h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center">
                    <div className="text-[9px] uppercase opacity-70 leading-none">Token</div>
                    <div className="text-sm font-bold leading-tight">{r.token_number ?? "—"}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-sm text-primary">{r.patient?.name ?? "Unknown"}</p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{r.patient?.patient_code ?? ""}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{r.chief_complaint || "—"}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">{branchLabel(r.branch)}</span>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusStyles[s] ?? "bg-muted text-muted-foreground border-border")}>
                        {s}
                      </span>
                      {due > 0 && (
                        <span className="text-[10px] font-semibold text-destructive">₹{due} due</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </MobileShell>
  );
}
