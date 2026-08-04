import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchTodayQueue, branchLabel } from "@/lib/db";
import { today } from "@/lib/supabase";
import { useAuth, useEffectiveRole } from "@/lib/auth";

export const Route = createFileRoute("/doctor/rx/")({
  head: () => ({ meta: [{ title: "Rx Queue — Doctor" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["DOCTOR", "OWNER"]} permKey="rxQueue">
      <RxQueue />
    </AuthGate>
  ),
});

function daysPending(visitDate: string): number {
  return Math.max(0, Math.floor((Date.parse(today()) - Date.parse(visitDate)) / 86_400_000));
}

function RxQueue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const effectiveRole = useEffectiveRole();
  const branchScope = effectiveRole === "OWNER" ? undefined : user?.branch ?? undefined;
  const { data, isLoading } = useQuery({
    queryKey: ["today-queue", branchScope ?? "all"],
    queryFn: () => fetchTodayQueue(branchScope),
    refetchInterval: 15_000,
  });


  const rows = (data ?? []).filter((r) =>
    ["REGISTERED", "WAITING", "CASE_TAKING", "WAITING_DOCTOR", "PRESCRIBED"].includes(r.visit_status),
  );

  return (
    <MobileShell title="Doctor — Rx Queue" subtitle="Today + any pending">
      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Koi patient Rx ke liye pending nahi." />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const d = daysPending(r.visit_date);
            return (
            <li key={r.id}>
              <button
                onClick={() => navigate({ to: "/doctor/rx/consult/$token", params: { token: r.id } })}
                className="w-full text-left rounded-2xl bg-surface border border-border p-3.5 shadow-sm hover:border-primary/40 active:scale-[0.99] transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-primary text-primary-foreground text-[11px] font-bold px-2.5 py-1">
                      {r.token_number ?? "—"}
                    </span>
                    <span className="font-bold text-[15px] text-primary">{r.patient?.name}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {r.patient?.age ? `${r.patient.age}y` : ""} {r.patient?.gender ?? ""}
                  </span>
                </div>
                <div className="text-sm text-primary mt-1.5">{r.chief_complaint || "—"}</div>
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span>{branchLabel(r.branch)} • {r.visit_status}</span>
                  {d > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/30">
                      {d}d pending
                    </span>
                  )}
                </div>
              </button>
            </li>
          );})}
        </ul>
      )}
    </MobileShell>
  );
}
