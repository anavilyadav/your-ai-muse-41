import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RoleShell } from "@/components/yhc/RoleShell";
import { INCENTIVE_STAFF } from "@/lib/yhc-owner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/incentives")({
  head: () => ({ meta: [{ title: "Incentives — Owner" }, { name: "robots", content: "noindex" }] }),
  component: IncentivesPage,
});

function IncentivesPage() {
  const total = INCENTIVE_STAFF.reduce((a, x) => a + x.done, 0);
  return (
    <RoleShell title="Staff Incentives" subtitle="4% of revenue above baseline" showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4">
        <div className="text-[13px] text-primary-foreground/65">Incentive Pool This Month</div>
        <div className="text-3xl font-extrabold text-accent mt-1">₹4,200</div>
        <div className="text-[12px] text-primary-foreground/60 mt-0.5">4% of ₹1.05L growth above baseline</div>
      </div>
      <div className="mt-3 rounded-xl bg-accent/25 text-accent-foreground p-3 text-[12px]">
        💡 Sirf baseline se upar ki growth pe milta hai — RECP1, RECP2 & Telecaller ko, performance ke hisaab se
      </div>
      <ul className="mt-3 space-y-2.5">
        {INCENTIVE_STAFF.map((s, i) => {
          const pct = Math.round((s.done / s.target) * 100);
          const share = Math.round(4200 * (s.done / total));
          return (
            <li key={i} className="rounded-2xl bg-surface border border-border p-3.5">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-primary text-[15px]">{s.name}</div>
                  <div className="text-[12px] text-muted-foreground">{s.role}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-extrabold text-success">₹{share}</div>
                  <div className="text-[11px] text-muted-foreground">earned</div>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-[12px] text-muted-foreground mb-1">
                  <span>₹{(s.done / 1000).toFixed(0)}k / ₹{(s.target / 1000).toFixed(0)}k target</span>
                  <span className={cn("font-bold", pct >= 90 ? "text-success" : "text-accent-foreground")}>{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-accent/30">
                  <div
                    className={cn("h-2 rounded-full", pct >= 90 ? "bg-success" : "bg-accent")}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        onClick={() => toast("Manual split adjustment")}
        className="mt-4 w-full rounded-full bg-surface border border-border text-primary font-bold py-3 text-sm"
      >
        Adjust Split (Owner Discretion)
      </button>
    </RoleShell>
  );
}
