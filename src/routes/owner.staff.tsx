import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { RoleShell, Stat, Badge } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchStaff, branchLabel, addStaffProfile, updateStaffProfile, fetchCaseDrLevels, saveCaseDrLevels, unlockStaffLogin } from "@/lib/db";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

// Builds the create-staff-login call with the caller's real session JWT
// attached — the edge function now rejects anything without a valid
// OWNER-role token, so this header is required, not optional.
async function callCreateStaffLogin(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  return fetch(`${SUPABASE_URL}/functions/v1/create-staff-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ROLE_OPTIONS = ["RECP1", "RECP2", "DOCTOR", "CASE_DR", "PHARMA", "CALLING", "BACKEND"];
const BRANCH_OPTIONS = ["Bajaj Nagar", "Jagatpura", "Both"];

function AddStaffModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState(ROLE_OPTIONS[0]);
  const [branch, setBranch] = useState(BRANCH_OPTIONS[0]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const cleanMobile = mobile.replace(/\D/g, "");
    if (!name.trim() || cleanMobile.length !== 10) {
      toast.error("Naam aur 10-digit mobile number zaroori hai");
      return;
    }
    if (email.trim() && !email.includes("@")) {
      toast.error("Email sahi format mein daalo (ya khaali chhod do)");
      return;
    }
    if (email.trim() && pin.trim().length < 6) {
      toast.error("Login banane ke liye PIN kam se kam 6 digit ka hona chahiye");
      return;
    }
    setSaving(true);
    const res = await addStaffProfile({ name: name.trim(), mobile: cleanMobile, role, branch: branch === "Both" ? null : branch });
    if (!res.success) {
      setSaving(false);
      toast.error("Save nahi hua: " + res.error);
      return;
    }

    if (email.trim() && pin.trim()) {
      try {
        const fnRes = await callCreateStaffLogin({ action: "create", mobile: cleanMobile, email: email.trim(), pin: pin.trim() });
        const fnData = await fnRes.json();
        if (!fnRes.ok || fnData.error) {
          toast.error(name + " add ho gaye, lekin login banane mein dikkat: " + (fnData.error ?? "unknown error"));
        } else {
          toast.success(name + " add ho gaye aur login bhi ban gaya");
        }
      } catch {
        toast.error(name + " add ho gaye, lekin login create karte waqt network error aaya");
      }
    } else {
      toast.success(name + " add ho gaye. Login baad mein 'Set Login' se bana sakte ho.");
    }
    setSaving(false);
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
          <div className="border-t border-border pt-3 mt-1">
            <div className="text-[11px] font-bold text-muted-foreground uppercase mb-2">Login (optional — ab ya baad mein)</div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Real Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" placeholder="unki asli email" />
            <label className="text-[11px] font-bold text-muted-foreground uppercase mt-2 block">PIN</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={6} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" placeholder="6-digit PIN" />
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Add Staff"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditStaffModal({ s, onClose, onSaved }: { s: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(s.name ?? "");
  const [mobile, setMobile] = useState(s.mobile ?? "");
  const [role, setRole] = useState(s.role ?? ROLE_OPTIONS[0]);
  const [branch, setBranch] = useState(branchLabel(s.branch) || "Both");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const cleanMobile = mobile.replace(/\D/g, "");
    if (!name.trim() || cleanMobile.length !== 10) {
      toast.error("Naam aur 10-digit mobile number zaroori hai");
      return;
    }
    setSaving(true);
    const res = await updateStaffProfile({
      id: s.id,
      name: name.trim(),
      mobile: cleanMobile,
      role,
      branch: branch === "Both" ? null : branch,
    });
    setSaving(false);
    if (!res.success) {
      toast.error("Save nahi hua: " + res.error);
      return;
    }
    toast.success(name + " update ho gaye");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Edit Staff</h2>
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
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/owner/staff")({
  head: () => ({ meta: [{ title: "Staff — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <StaffPage />
    </AuthGate>
  ),
});

function EditEmailModal({ s, onClose, onSaved }: { s: any; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(s.email ?? "");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const needsPin = !s.has_login;

  const submit = async () => {
    if (!email.includes("@")) { toast.error("Sahi email daalo"); return; }
    if (needsPin && pin.trim().length < 6) { toast.error("Pehli baar login banane ke liye PIN chahiye (6 digit)"); return; }
    setSaving(true);
    try {
      const res = await callCreateStaffLogin(
        needsPin
          ? { action: "create", mobile: s.mobile, email: email.trim(), pin: pin.trim() }
          : { action: "update-email", mobile: s.mobile, email: email.trim() },
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error("Nahi hua: " + (data.error ?? "unknown error"));
      } else {
        toast.success("Email update ho gayi");
        onSaved();
        onClose();
      }
    } catch {
      toast.error("Network error — dobara try karo");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">{s.name} — Login Email</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
          {needsPin ? "Abhi is staff ka login bana nahi hai — email + PIN daalo." : "Login pehle se hai — sirf email badal rahe ho, PIN wahi rahega."}
        </p>
        <div className="flex flex-col gap-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Real email" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          {needsPin && (
            <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={6} placeholder="6-digit PIN" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          )}
          <button onClick={submit} disabled={saving} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const { data: levels } = useQuery({ queryKey: ["case-dr-levels"], queryFn: fetchCaseDrLevels });
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingEmail, setEditingEmail] = useState<any | null>(null);
  const [editingStaff, setEditingStaff] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const staff = (data ?? []) as any[];

  const deleteStaff = async (s: any) => {
    if (!window.confirm(`${s.name} ko remove karein? Ye login se turant baahar ho jayenge, lekin unke purane visits/records mein naam waise hi rahega.`)) return;
    setDeletingId(s.id);
    try {
      const res = await callCreateStaffLogin({ action: "delete", mobile: s.mobile });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error("Remove nahi hua: " + (data.error ?? "unknown error"));
      } else {
        toast.success(`${s.name} remove ho gaye`);
        queryClient.invalidateQueries({ queryKey: ["owner-staff"] });
      }
    } catch {
      toast.error("Network error — dobara try karo");
    }
    setDeletingId(null);
  };

  const setLevel = async (userId: string, level: "Junior" | "Senior") => {
    const next = { ...(levels ?? {}), [userId]: level };
    try {
      await saveCaseDrLevels(next);
      queryClient.invalidateQueries({ queryKey: ["case-dr-levels"] });
    } catch (e: any) {
      toast.error("Save nahi hua: " + (e?.message ?? "unknown error"));
    }
  };
  const active = staff.filter((s) => (s.status ?? "Active") === "Active").length;
  const leave = staff.length - active;

  return (
    <RoleShell wide
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
      {editingEmail && (
        <EditEmailModal
          s={editingEmail}
          onClose={() => setEditingEmail(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["owner-staff"] })}
        />
      )}
      {editingStaff && (
        <EditStaffModal
          s={editingStaff}
          onClose={() => setEditingStaff(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["owner-staff"] })}
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
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
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
                  <button
                    onClick={() => setEditingEmail(s)}
                    className="text-[11px] text-primary underline mt-0.5 truncate block"
                  >
                    {s.email ? s.email : "Set login email →"}
                  </button>
                  {s.has_login && (
                    <button
                      onClick={async () => {
                        const res = await unlockStaffLogin(s.mobile);
                        if (res.success) toast.success(`${s.name} ka login unlock ho gaya`);
                        else toast.error("Unlock nahi hua: " + res.error);
                      }}
                      className="text-[10px] text-muted-foreground underline mt-0.5 block"
                    >
                      🔓 Unlock Login (5 galat attempt lock hata do)
                    </button>
                  )}
                  {role === "CASE_DR" && (
                    <div className="flex gap-1.5 mt-1.5">
                      {(["Junior", "Senior"] as const).map((lvl) => {
                        const active = (levels?.[s.id] ?? "Senior") === lvl;
                        return (
                          <button
                            key={lvl}
                            onClick={() => setLevel(s.id, lvl)}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[10px] font-bold border",
                              active ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                            )}
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-3 mt-1.5">
                    <button onClick={() => setEditingStaff(s)} className="text-[11px] text-muted-foreground underline">
                      Edit
                    </button>
                    {role !== "OWNER" && (
                      <button
                        onClick={() => deleteStaff(s)}
                        disabled={deletingId === s.id}
                        className="text-[11px] text-destructive underline disabled:opacity-50"
                      >
                        {deletingId === s.id ? "Removing…" : "Remove"}
                      </button>
                    )}
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
