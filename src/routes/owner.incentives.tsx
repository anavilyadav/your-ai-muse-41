import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RoleShell } from "@/components/yhc/RoleShell";
import { LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchOwnerStats, fetchStaff } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/incentives")({
  head: () => ({ meta: [{ title: "Incentives — Owner" }, { name: "robots", content: "noindex" }] }),
  component: IncentivesPage,
});

const INCENTIVE_ROLES = ["RECP1", "RECP2", "CALLING", "TELECALLER"];

function IncentivesPage() {
  const stats = useQuery({ queryKey: ["owner-stats"], queryFn: fetchOwnerStats });
  const staffQ = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const month = stats.data?.monthRevenue ?? 0;
  const baseline = 100000;
  const growth = Math.max(0, month - baseline);
  const pool = Math.round(growth * 0.04);

  const staff = ((staffQ.data ?? []) as any[]).filter((s) =>
    INCENTIVE_ROLES.includes(s.role ?? ""),
  );
  const share = staff.length ? Math.round(pool / staff.length) : 0;

  return (
    <RoleShell title="Staff Incentives" subtitle="4% of revenue above baseline" showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4">
        <div className="text-[13px] text-primary-foreground/65">Incentive Pool This Month</div>
        <div className="text-3xl font-extrabold text-accent mt-1">₹{pool.toLocaleString("en-IN")}</div>
        <div className="text-[12px] text-primary-foreground/60 mt-0.5">
          4% of ₹{growth.toLocaleString("en-IN")} growth above ₹{baseline.toLocaleString("en-IN")} baseline
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-accent/25 text-accent-foreground p-3 text-[12px]">
        💡 Sirf baseline se upar ki growth pe milta hai — front-office & telecaller ko equally
      </div>

      {stats.isLoading || staffQ.isLoading ? (
        <LoadingBlock />
      ) : staff.length === 0 ? (
        <EmptyBlock label="No incentive-eligible staff found." />
      ) : (
        <ul className="mt-3 space-y-2.5">
          {staff.map((s: any) => (
            <li key={s.id} className="rounded-2xl bg-surface border border-border p-3.5">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-primary text-[15px]">{s.name}</div>
                  <div className="text-[12px] text-muted-foreground">{s.role}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-extrabold text-success">₹{share.toLocaleString("en-IN")}</div>
                  <div className="text-[11px] text-muted-foreground">earned</div>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-[12px] text-muted-foreground mb-1">
                  <span>Equal split from pool</span>
                  <span className={cn("font-bold", pool > 0 ? "text-success" : "text-muted-foreground")}>
                    {pool > 0 ? "Active" : "No growth yet"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-accent/30">
                  <div
                    className="h-2 rounded-full bg-success"
                    style={{ width: `${pool > 0 ? 100 : 0}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => toast("Manual split adjustment")}
        className="mt-4 w-full rounded-full bg-surface border border-border text-primary font-bold py-3 text-sm"
      >
        Adjust Split (Owner Discretion)
      </button>
    </RoleShell>
  );
}
