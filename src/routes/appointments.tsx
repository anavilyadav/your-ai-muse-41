import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Clock, MessageCircle, PhoneCall, XCircle, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import { fetchAppointments, createAppointment, updateAppointmentStatus } from "@/lib/db";
import { sendWhatsApp } from "@/lib/whatsapp";
import { today } from "@/lib/supabase";

export const Route = createFileRoute("/appointments")({
  head: () => ({ meta: [{ title: "Appointments — YHC Jaipur" }] }),
  component: AppointmentsPage,
});

const branches: ("All" | "Bajaj Nagar" | "Jagatpura")[] = ["All", "Bajaj Nagar", "Jagatpura"];

const statusStyle: Record<string, string> = {
  Confirmed: "bg-success/15 text-success border-success/40",
  Tentative: "bg-accent/25 text-accent-foreground border-accent/50",
  Cancelled: "bg-destructive/15 text-destructive border-destructive/40",
  Arrived: "bg-primary/15 text-primary border-primary/40",
};

function NewAppointmentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("");
  const [branch, setBranch] = useState("Bajaj Nagar");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || !time.trim()) { toast.error("Naam aur time zaroori hai"); return; }
    setSaving(true);
    const res = await createAppointment({
      patient_name: name.trim(),
      mobile: mobile.replace(/\D/g, ""),
      appointment_date: date,
      appointment_time: time,
      branch,
      reason: reason.trim() || undefined,
    });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Appointment ban gaya");
    if (mobile.replace(/\D/g, "").length === 10) {
      sendWhatsApp({
        campaignName: "APPOINTMENT_REMINDER",
        destination: mobile.replace(/\D/g, ""),
        userName: name.trim(),
        templateParams: [name.trim(), date, time],
      });
    }
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">New Appointment</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Patient naam" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" maxLength={10} placeholder="Mobile" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          </div>
          <div className="flex gap-1.5">
            {["Bajaj Nagar", "Jagatpura"].map((b) => (
              <button key={b} onClick={() => setBranch(b)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{b}</button>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          <button onClick={submit} disabled={saving} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Create Appointment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppointmentsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["appointments"], queryFn: () => fetchAppointments() });
  const queryClient = useQueryClient();
  const appts = (data ?? []) as any[];
  const [branch, setBranch] = useState<(typeof branches)[number]>("All");
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(
    () => (branch === "All" ? appts : appts.filter((a) => a.branch === branch)),
    [appts, branch],
  );

  const stats = useMemo(() => {
    const confirmed = appts.filter((a) => a.status === "Confirmed" || a.status === "Arrived").length;
    const arrived = appts.filter((a) => a.status === "Arrived").length;
    const cancelled = appts.filter((a) => a.status === "Cancelled").length;
    return { confirmed, arrived, cancelled };
  }, [appts]);

  const setStatus = async (a: any, status: string) => {
    const res = await updateAppointmentStatus(a.id, status);
    if (res.success) {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      status === "Arrived" ? toast.success(`${a.patient_name} marked arrived`) : toast.error(`${a.patient_name} cancelled`);
    } else {
      toast.error("Update nahi hua: " + res.error);
    }
  };

  return (
    <MobileShell
      title="Appointments"
      subtitle="Today's schedule"
      showBack
      right={
        <button onClick={() => setShowNew(true)} className="rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-3 py-1.5 inline-flex items-center gap-1">
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      }
    >
      {showNew && <NewAppointmentModal onClose={() => setShowNew(false)} onAdded={() => queryClient.invalidateQueries({ queryKey: ["appointments"] })} />}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Confirmed" value={stats.confirmed} tone="success" />
        <StatCard label="Arrived" value={stats.arrived} />
        <StatCard label="Cancelled" value={stats.cancelled} tone="destructive" />
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {branches.map((b) => (
          <button
            key={b}
            onClick={() => setBranch(b)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition",
              branch === b
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-surface text-foreground border-border",
            )}
          >
            {b}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
      ) : (
      <ul className="mt-3 space-y-2">
        {filtered.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-8">No appointments.</li>
        )}
        {filtered.map((a) => (
          <li
            key={a.id}
            className={cn(
              "rounded-xl bg-surface border border-border border-l-4 p-3",
              a.status === "Arrived" && "border-l-primary",
              a.status === "Confirmed" && "border-l-success",
              a.status === "Tentative" && "border-l-accent",
              a.status === "Cancelled" && "border-l-destructive opacity-70",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <Clock className="h-3.5 w-3.5" /> {a.appointment_time}
                  {a.slot_minutes && (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      ({a.slot_minutes} min)
                    </span>
                  )}
                </div>
                <div className="mt-1 font-semibold text-sm truncate">{a.patient_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {a.doctor ?? "Dr. Yadav"} • {a.branch}
                </div>
                {a.reason && <div className="text-[11px] text-foreground/70 mt-1 truncate">{a.reason}</div>}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  statusStyle[a.status] ?? statusStyle.Confirmed,
                )}
              >
                {a.status}
              </span>
            </div>

            {a.status !== "Cancelled" && a.status !== "Arrived" && (
              <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                <a
                  href={`tel:${a.mobile}`}
                  className="rounded-lg bg-success text-success-foreground py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <PhoneCall className="h-3 w-3" /> Call
                </a>
                <a
                  href={`https://wa.me/91${a.mobile}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-accent text-accent-foreground py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <MessageCircle className="h-3 w-3" /> WA
                </a>
                <button
                  onClick={() => setStatus(a, "Arrived")}
                  className="rounded-lg bg-primary text-primary-foreground py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <CheckCircle2 className="h-3 w-3" /> Arrived
                </button>
                <button
                  onClick={() => setStatus(a, "Cancelled")}
                  className="rounded-lg bg-surface border border-destructive/40 text-destructive py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <XCircle className="h-3 w-3" /> Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      )}

      <div className="mt-6 rounded-xl bg-primary/5 border border-primary/20 p-3 flex items-center gap-2 text-[11px] text-primary">
        <CalendarCheck className="h-4 w-4 shrink-0" />
        Tap "Arrived" to mark them in for today.
      </div>
    </MobileShell>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "destructive";
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <div
        className={cn(
          "text-lg font-bold",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
