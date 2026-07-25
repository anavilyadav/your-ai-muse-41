import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { RoleShell, Stat, Badge } from "@/components/yhc/RoleShell";
import { LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchStaff, branchLabel, addStaffProfile } from "@/lib/db";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS = ["RECP1", "RECP2", "DOCTOR", "CASE_DR", "PHARMA", "CALLING", "BACKEND"];
const BRANCH_OPTIONS = ["Bajaj Nagar", "Jagatpura", "Both"];

function AddStaffModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [role, setRole] = useState(ROLE_OPTIONS[0]);
  const [branch, setBranch] = useState(BRANCH_OPTIONS[0]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const cleanMobile = mobile.replace(/\D/g, "");
    if (!name.trim() || cleanMobile.length !== 10) {
      toast.error("Naam aur 10-digit mobile number zaroori hai");
      return;
    }
    setSaving(true);
    const res = await addStaffProfile({ name: name.trim(), mobile: cleanMobile, role, branch: branch === "Both" ? null : branch });
    setSaving(false);
    if (!res.success) {
      toast.error("Save nahi hua: " + res.error);
      return;
    }
    toast.success(name + " add ho gaye. Login banane ke liye Supabase mein " + cleanMobile + "@yhcos.in ka account banana hoga (PIN set karke) — ek baar ka manual step hai.");
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Add Staff</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" placeholder="Staff ka naam" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Mobile</label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" maxLength={10} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" placeholder="10-digit number" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Role</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {ROLE_OPTIONS.map((r) => (
                <button key={r} onClick={() => setRole(r)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", role === r ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Branch</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {BRANCH_OPTIONS.map((b) => (
                <button key={b} onClick={() => setBranch(b)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{b}</button>
              ))}
            </div>
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Add Staff"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
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
          onClick={() => setShowAdd(true)}
          className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5"
        >
          + Staff
        </button>
      }
    >
      {showAdd && (
        <AddStaffModal
          onClose={() => setShowAdd(false)}
          onAdded={() => queryClient.invalidateQueries({ queryKey: ["owner-staff"] })}
        />
      )}
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
