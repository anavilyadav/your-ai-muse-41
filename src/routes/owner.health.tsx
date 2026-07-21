import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RoleShell, Badge } from "@/components/yhc/RoleShell";
import { HEALTH_CHECKS } from "@/lib/yhc-owner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/health")({
  head: () => ({ meta: [{ title: "System Health — Owner" }, { name: "robots", content: "noindex" }] }),
  component: HealthPage,
});

function HealthPage() {
  const okCount = HEALTH_CHECKS.filter((h) => h.status === "ok").length;
  const warnCount = HEALTH_CHECKS.length - okCount;
  return (
    <RoleShell title="System Health" subtitle="Automated checks" showBack>
      <div className="rounded-2xl bg-success/10 p-5 text-center">
        <div className="text-3xl">✓</div>
        <div className="text-[17px] font-extrabold text-success mt-1">System Healthy</div>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          {okCount} OK • {warnCount} warnings • 0 errors
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {HEALTH_CHECKS.map((h, i) => (
          <li
            key={i}
            className={cn(
              "rounded-2xl bg-surface border border-border border-l-[4px] p-3.5 flex justify-between items-center",
              h.status === "ok" ? "border-l-success" : "border-l-accent",
            )}
          >
            <span className="text-sm text-primary">{h.check}</span>
            <Badge tone={h.status === "ok" ? "success" : "warn"}>
              {h.status === "ok" ? "✓ OK" : "⚠ Check"}
            </Badge>
          </li>
        ))}
      </ul>
      <button
        onClick={() => toast("Running all checks…")}
        className="mt-4 w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm"
      >
        Run Health Check Now
      </button>
    </RoleShell>
  );
}
