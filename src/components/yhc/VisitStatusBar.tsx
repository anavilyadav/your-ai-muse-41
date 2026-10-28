import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { cancelVisit, markVisitArrived, rescheduleVisit, updateAppointmentStatus } from "@/lib/db";
import { today as todayStr } from "@/lib/supabase";
import { NewAppointmentModal, RescheduleModal } from "@/routes/appointments";
import { cn } from "@/lib/utils";

type PatientLite = { id: string; name: string; mobile?: string | null; branch?: string | null; wa_consent?: boolean | null };

// The same three status buttons under EVERY patient entry of the reception
// queue (Dr. Yadav, 26 Oct 2026): Arrived, Reschedule, Cancel.
//  - Arrived    -> records the arrival time (and the patient's appointment as
//                  Arrived, if they had one).
//  - Reschedule -> pick the new day/time; the visit leaves today's queue (or,
//                  if a payment/advance is on it, moves to the new date).
//  - Cancel     -> takes the patient out of the queue. Refused while a payment
//                  is on the visit: that needs the Owner's adjustment first.
export function VisitStatusBar({
  visit,
  patient,
  appt,
  className,
  extra,
}: {
  visit: { id: string; visit_date: string; arrived_at?: string | null };
  patient: PatientLite;
  appt?: any;
  className?: string;
  /** Extra button(s) shown in the same row, after Cancel. */
  extra?: ReactNode;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["today-queue"] });
    qc.invalidateQueries({ queryKey: ["day-queue"] });
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["flow-today"] });
  };

  const arrive = async () => {
    setBusy(true);
    const res = await markVisitArrived(visit.id);
    if (res.success && appt && (appt.status === "Confirmed" || appt.status === "Tentative")) {
      await updateAppointmentStatus(appt.id, "Arrived");
    }
    setBusy(false);
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    toast.success(`${patient.name} — marked Arrived`);
    refresh();
  };

  const unarrive = async () => {
    setBusy(true);
    const res = await markVisitArrived(visit.id, false);
    setBusy(false);
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    refresh();
  };

  const cancel = async () => {
    if (!window.confirm(`${patient.name} ko queue se hata dein (cancel)?`)) return;
    setBusy(true);
    const res = await cancelVisit(visit.id, "Cancel (queue)");
    if (res.success && appt && (appt.status === "Confirmed" || appt.status === "Tentative")) {
      await updateAppointmentStatus(appt.id, "Cancelled");
    }
    setBusy(false);
    if (!res.success) { toast.error(res.error ?? "Cancel nahi hua"); return; }
    toast.success(`${patient.name} — cancel ho gaya`);
    refresh();
  };

  // After a new day/time is chosen: move / release today's visit.
  const afterReschedule = async (info?: { date: string; time: string }) => {
    refresh();
    if (!info || info.date <= todayStr()) return; // same day, only the time changed
    const res = await rescheduleVisit(visit.id, info.date);
    if (!res.success) { toast.error(res.error ?? "Visit reschedule nahi hui"); return; }
    toast.success(res.moved ? `${patient.name} ki visit ${info.date} pe chali gayi (token ${res.token})` : `${patient.name} aaj ki queue se hat gaye — ${info.date} ${info.time} ko aayenge`);
    refresh();
  };

  const btn = "rounded-full border px-2.5 py-1 text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50";
  const arrivedTime = visit.arrived_at
    ? new Date(visit.arrived_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {arrivedTime ? (
        <button type="button" disabled={busy} onClick={unarrive} title="Galti se mark hua ho to dabao" className={cn(btn, "bg-success/10 border-success/40 text-success")}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Arrived {arrivedTime}
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={arrive} className={cn(btn, "bg-primary text-primary-foreground border-primary")}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Arrived
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => setRescheduling(true)} className={cn(btn, "bg-surface border-primary/40 text-primary")}>
        <CalendarClock className="h-3.5 w-3.5" /> Reschedule
      </button>
      <button type="button" disabled={busy} onClick={cancel} className={cn(btn, "bg-surface border-destructive/40 text-destructive")}>
        <XCircle className="h-3.5 w-3.5" /> Cancel
      </button>
      {extra}

      {rescheduling && appt && (
        <RescheduleModal appt={appt} onClose={() => setRescheduling(false)} onRescheduled={(info) => { setRescheduling(false); void afterReschedule(info); }} />
      )}
      {rescheduling && !appt && (
        <NewAppointmentModal initialPatient={patient} onClose={() => setRescheduling(false)} onAdded={(info) => { setRescheduling(false); void afterReschedule(info); }} />
      )}
    </div>
  );
}
