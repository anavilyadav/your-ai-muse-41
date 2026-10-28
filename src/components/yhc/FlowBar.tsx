import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchFlowToday, fetchAppointments } from "@/lib/db";
import { today } from "@/lib/supabase";
import { summarizeFlow } from "@/lib/flow";
import { cn } from "@/lib/utils";

// "Live Flow" — every patient of today by stage, with the token being served
// now in each stage. Shown on the reception queue, Case board, Doctor queue
// and Pharmacy queue so everyone along the line sees the same picture (Dr.
// Yadav, 23 Oct 2026). Tokens and stages only, no patient details.
export function FlowBar({ branch }: { branch?: string }) {
  const { data } = useQuery({
    queryKey: ["flow-today", branch ?? "all"],
    queryFn: () => fetchFlowToday(branch),
    refetchInterval: 15_000,
  });
  // Same key as the Appointments board, so the list is shared, not fetched twice.
  const { data: appts } = useQuery({
    queryKey: ["appointments", today()],
    queryFn: () => fetchAppointments(today()),
    refetchInterval: 30_000,
  });
  const booked = useMemo(
    () =>
      (appts?.rows ?? []).filter(
        (a: any) => (a.status === "Confirmed" || a.status === "Tentative") && (!branch || a.branch === branch),
      ),
    [appts, branch],
  );
  const stages = useMemo(() => summarizeFlow(data ?? [], booked), [data, booked]);
  if ((!data || data.length === 0) && booked.length === 0) return null;

  return (
    <section aria-label="Live flow" className="mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground px-1 mb-1.5">
        Live Flow — where everyone is today
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {stages.map(({ stage, count, tokens, current }) => {
          const done = stage.key === "done";
          return (
            <div
              key={stage.key}
              className={cn(
                "shrink-0 min-w-[112px] max-w-[160px] rounded-xl border p-2",
                count === 0 ? "bg-surface/60 border-border opacity-70" : done ? "bg-success/10 border-success/40" : "bg-surface border-primary/30",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold text-primary">{stage.label}</span>
                <span className="text-base font-extrabold text-primary leading-none">{count}</span>
              </div>
              {!done && current && (
                <div className="mt-1 text-[11px] font-bold text-accent-foreground bg-accent/30 rounded px-1.5 py-0.5 inline-block">
                  {stage.key === "booked" ? "First" : "Now"}: {current}
                </div>
              )}
              {!done && tokens.length > 1 && (
                <div className="mt-1 text-[10.5px] text-muted-foreground leading-snug">
                  {stage.key === "booked" ? "Then" : "Next"}: {tokens.slice(1, 5).join(", ")}{tokens.length > 5 ? ` +${tokens.length - 5}` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
