import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RoleShell, Stat, Badge } from "@/components/yhc/RoleShell";
import { LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchStaff, branchLabel } from "@/lib/db";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/staff")({
  head: () => ({ meta: [{ title: "Staff — Owner" }, { name: "robots", content: "noindex" }] }),
  component: StaffPage,
});

const ROLE_COLOR: Record<string, string> = {
  RECP1: "bg-accent text-accent-foreground",
  RECP2: "bg-accent text-accent-foreground",
  CASE_DR: "bg-primary text-primary-foreground",
  DOCTOR: "bg-success text-success-foreground",
  PHARMA: "bg-purple-500 text-white",
  CALLING: "bg-sky-600 text-white",
  BACKEND: "bg-slate-500 text-white",
  OWNER: "bg-destructive text-destructive-foreground",
};

function capFor(role: string): string {
  if (role === "CASE_DR") return "N";
  return "1";
}

function StaffPage() {
  const { data, isLoading } = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const staff = (data ?? []) as any[];
  const active = staff.filter((s) => (s.status ?? "Active") === "Active").length;
  const leave = staff.length - active;

  return (
    <RoleShell
      title="Staff Management"
      subtitle={`${staff.length} roles`}
      nav={OWNER_NAV}
      right={
        <button
          onClick={() => toast("Add new staff member")}
          className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5"
        >
          + Staff
        </button>
      }
    >
      <div className="flex gap-2">
        <Stat v={staff.length} l="Total" />
        <Stat v={active} l="Active" tone="success" />
        <Stat v={leave} l="On Leave" tone="accent" />
      </div>
      <div className="mt-3 rounded-xl bg-accent/25 text-accent-foreground p-3 text-[12px]">
        💡 "N" capacity = unlimited parallel (Case-DRs can take many cases at once)
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : staff.length === 0 ? (
        <EmptyBlock label="No staff found." />
      ) : (
        <ul className="mt-3 space-y-2">
          {staff.map((s: any) => {
            const role = s.role ?? "STAFF";
            const cap = s.cap ?? capFor(role);
            const status = s.status ?? "Active";
            return (
              <li key={s.id} className="rounded-2xl bg-surface border border-border p-3 flex items-center gap-3">
                <div className={cn("h-11 w-11 rounded-full grid place-items-center font-extrabold text-base shrink-0", ROLE_COLOR[role] ?? "bg-primary text-primary-foreground")}>
                  {(s.name ?? "?")[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-primary text-[15px] truncate">{s.name}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {role} • {branchLabel(s.branch) || "Both"} • Cap: {cap}
                  </div>
                </div>
                <Badge tone={status === "Active" ? "success" : "warn"}>{status}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </RoleShell>
  );
}
