import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, Clock, MessageCircle, PhoneCall, XCircle } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import {
  updateAppointment,
  useAppointments,
  type ApptStatus,
  type Branch,
} from "@/lib/yhc-store";

export const Route = createFileRoute("/appointments")({
  head: () => ({ meta: [{ title: "Appointments — YHC Jaipur" }] }),
  component: AppointmentsPage,
});

const branches: ("All" | Branch)[] = ["All", "Bajaj Nagar", "Jagatpura"];

const statusStyle: Record<ApptStatus, string> = {
  Confirmed: "bg-success/15 text-success border-success/40",
  Tentative: "bg-accent/25 text-accent-foreground border-accent/50",
  Cancelled: "bg-destructive/15 text-destructive border-destructive/40",
  Arrived: "bg-primary/15 text-primary border-primary/40",
};

function AppointmentsPage() {
  const appts = useAppointments();
  const [branch, setBranch] = useState<(typeof branches)[number]>("All");

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

  return (
    <MobileShell title="Appointments" subtitle="Today's schedule" showBack>
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
                  <Clock className="h-3.5 w-3.5" /> {a.time}
                  <span className="text-[10px] font-normal text-muted-foreground">
                    ({a.slotMinutes} min)
                  </span>
                </div>
                <div className="mt-1 font-semibold text-sm truncate">{a.patientName}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {a.doctor} • {a.branch}
                </div>
                <div className="text-[11px] text-foreground/70 mt-1 truncate">{a.reason}</div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  statusStyle[a.status],
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
                  onClick={() => {
                    updateAppointment(a.id, { status: "Arrived" });
                    toast.success(`${a.patientName} marked arrived`);
                  }}
                  className="rounded-lg bg-primary text-primary-foreground py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <CheckCircle2 className="h-3 w-3" /> Arrived
                </button>
                <button
                  onClick={() => {
                    updateAppointment(a.id, { status: "Cancelled" });
                    toast.error(`${a.patientName} cancelled`);
                  }}
                  className="rounded-lg bg-surface border border-destructive/40 text-destructive py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <XCircle className="h-3 w-3" /> Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-xl bg-primary/5 border border-primary/20 p-3 flex items-center gap-2 text-[11px] text-primary">
        <CalendarCheck className="h-4 w-4 shrink-0" />
        Tap "Arrived" to auto-add the patient to today's queue. (Wired next.)
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
