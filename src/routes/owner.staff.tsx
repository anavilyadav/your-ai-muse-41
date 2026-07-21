import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RoleShell, Stat, Badge } from "@/components/yhc/RoleShell";
import { STAFF, ROLE_COLOR } from "@/lib/yhc-owner";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/staff")({
  head: () => ({ meta: [{ title: "Staff — Owner" }, { name: "robots", content: "noindex" }] }),
  component: StaffPage,
});

function StaffPage() {
  return (
    <RoleShell
      title="Staff Management"
      subtitle="8 roles"
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
        <Stat v={8} l="Total" />
        <Stat v={7} l="Active" tone="success" />
        <Stat v={1} l="On Leave" tone="accent" />
      </div>
      <div className="mt-3 rounded-xl bg-accent/25 text-accent-foreground p-3 text-[12px]">
        💡 "N" capacity = unlimited parallel (Case-DRs can take many cases at once)
      </div>
      <ul className="mt-3 space-y-2">
        {STAFF.map((s, i) => (
          <li key={i} className="rounded-2xl bg-surface border border-border p-3 flex items-center gap-3">
            <div className={cn("h-11 w-11 rounded-full grid place-items-center font-extrabold text-base shrink-0", ROLE_COLOR[s.role] ?? "bg-primary text-primary-foreground")}>
              {s.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-primary text-[15px] truncate">{s.name}</div>
              <div className="text-[12px] text-muted-foreground truncate">
                {s.role} • {s.branch} • Cap: {s.cap}
              </div>
            </div>
            <Badge tone={s.status === "Active" ? "success" : "warn"}>{s.status}</Badge>
          </li>
        ))}
      </ul>
    </RoleShell>
  );
}
