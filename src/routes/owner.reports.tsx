import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchReports, BRANCH_LABELS } from "@/lib/db";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/reports")({
  head: () => ({ meta: [{ title: "Reports — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <ReportsPage />
    </AuthGate>
  ),
});

const PERIODS = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "year", label: "This Year" },
] as const;

const BRANCHES = BRANCH_LABELS;

function downloadCSV(filename: string, rows: [string, string][]) {
  const csv = ["Metric,Value", ...rows.map(([k, v]) => `"${k}","${v}"`)].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function BranchCompareModal({ period, onClose }: { period: string; onClose: () => void }) {
  const q1 = useQuery({ queryKey: ["reports-branch", period, BRANCHES[0]], queryFn: () => fetchReports(period as any, BRANCHES[0]) });
  const q2 = useQuery({ queryKey: ["reports-branch", period, BRANCHES[1]], queryFn: () => fetchReports(period as any, BRANCHES[1]) });
  const rows1 = q1.data?.rows ?? [];
  const rows2 = q2.data?.rows ?? [];
  const loading = q1.isLoading || q2.isLoading;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Branch Comparison</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {loading ? (
          <LoadingBlock />
        ) : (
          <div className="rounded-2xl bg-surface border border-border overflow-hidden">
            <div className="grid grid-cols-3 bg-primary text-primary-foreground text-[11px] font-bold px-3 py-2">
              <span>Metric</span>
              <span className="text-right">{BRANCHES[0]}</span>
              <span className="text-right">{BRANCHES[1]}</span>
            </div>
            {rows1.map(([k, v], i) => (
              <div key={k} className={cn("grid grid-cols-3 px-3 py-2.5 text-[12px]", i < rows1.length - 1 && "border-b border-border")}>
                <span className="text-muted-foreground truncate">{k}</span>
                <span className="text-right font-bold text-primary">{v}</span>
                <span className="text-right font-bold text-primary">{rows2[i]?.[1] ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportsPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("month");
  const [showCompare, setShowCompare] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", period],
    queryFn: () => fetchReports(period),
  });
  const rows = data?.rows ?? [];

  return (
    <RoleShell title="Reports & Analytics" nav={OWNER_NAV}>
      {showCompare && <BranchCompareModal period={period} onClose={() => setShowCompare(false)} />}
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
        onClick={() => {
          if (!rows.length) { toast.error("Kuch data nahi hai export karne ko"); return; }
          downloadCSV(`YHC-Report-${period}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
          toast.success("Report download ho gayi");
        }}
        className="mt-4 w-full rounded-full bg-success text-success-foreground font-bold py-3 text-sm"
      >
        📤 Export Report (CSV)
      </button>
      <button
        onClick={() => setShowCompare(true)}
        className="mt-2 w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm"
      >
        📊 Compare Branches
      </button>
    </RoleShell>
  );
}
