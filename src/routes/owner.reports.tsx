import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RoleShell } from "@/components/yhc/RoleShell";
import { LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchReports } from "@/lib/db";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/reports")({
  head: () => ({ meta: [{ title: "Reports — Owner" }, { name: "robots", content: "noindex" }] }),
  component: ReportsPage,
});

const PERIODS = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "year", label: "This Year" },
] as const;

function ReportsPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("month");
  const { data, isLoading } = useQuery({
    queryKey: ["reports", period],
    queryFn: () => fetchReports(period),
  });
  const rows = data?.rows ?? [];

  return (
    <RoleShell title="Reports & Analytics" nav={OWNER_NAV}>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border whitespace-nowrap",
              period === p.key ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="mt-3 rounded-2xl bg-surface border border-border p-1.5">
          {rows.map(([k, v], i) => (
            <div
              key={k}
              className={cn(
                "flex justify-between items-center px-3 py-3",
                i < rows.length - 1 && "border-b border-border",
              )}
            >
              <span className="text-sm text-muted-foreground">{k}</span>
              <span className="text-[15px] font-bold text-primary">{v}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => toast("Report exported")}
        className="mt-4 w-full rounded-full bg-success text-success-foreground font-bold py-3 text-sm"
      >
        📤 Export Report (PDF)
      </button>
      <button
        onClick={() => toast("Branch comparison view")}
        className="mt-2 w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm"
      >
        📊 Compare Branches
      </button>
    </RoleShell>
  );
}
