import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchTodayQueue, branchLabel } from "@/lib/db";

export const Route = createFileRoute("/pharmacy/")({
  head: () => ({ meta: [{ title: "Pharmacy Queue — YHC" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["PHARMA", "OWNER"]}>
      <PharmacyQueue />
    </AuthGate>
  ),
});

function PharmacyQueue() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["today-queue"],
    queryFn: fetchTodayQueue,
    refetchInterval: 15_000,
  });
  const rows = (data ?? []).filter((r) => r.visit_status === "PHARMACY");

  return (
    <MobileShell title="Pharmacy Queue" subtitle="Today">
      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Koi patient dispense ke liye pending nahi." />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => navigate({ to: "/pharmacy/dispense/$token", params: { token: r.id } })}
                className="w-full text-left rounded-2xl bg-surface border border-border p-3.5 shadow-sm hover:border-primary/40 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-primary text-primary-foreground text-[11px] font-bold px-2.5 py-1">
                      {r.token_number ?? "—"}
                    </span>
                    <span className="font-bold text-[15px] text-primary">{r.patient?.name}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{branchLabel(r.branch)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{r.chief_complaint || "—"}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </MobileShell>
  );
}
