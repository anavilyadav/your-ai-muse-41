import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RoleShell } from "@/components/yhc/RoleShell";
import { REPORT_ROWS } from "@/lib/yhc-owner";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/reports")({
  head: () => ({ meta: [{ title: "Reports — Owner" }, { name: "robots", content: "noindex" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const [period, setPeriod] = useState("This Month");
  return (
    <RoleShell title="Reports & Analytics" nav={OWNER_NAV}>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {["This Week", "This Month", "Last Month", "This Year"].map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border whitespace-nowrap",
              period === p ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-2xl bg-surface border border-border p-1.5">
        {REPORT_ROWS.map(([k, v], i) => (
          <div
            key={k}
            className={cn(
              "flex justify-between items-center px-3 py-3",
              i < REPORT_ROWS.length - 1 && "border-b border-border",
            )}
          >
            <span className="text-sm text-muted-foreground">{k}</span>
            <span className="text-[15px] font-bold text-primary">{v}</span>
          </div>
        ))}
      </div>
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
