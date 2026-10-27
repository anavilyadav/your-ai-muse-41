import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarPlus, DoorOpen, PhoneCall, Play, CheckCircle2, XCircle } from "lucide-react";
import { fetchUpcomingAppointmentsByPatient, apptTypeLabel, type ApptType } from "@/lib/db";
import { today as todayStr } from "@/lib/supabase";
import { useAppointmentActions } from "@/hooks/use-appointment-actions";
import { NewAppointmentModal, RescheduleModal, apptStatusStyle } from "@/routes/appointments";
import { cn } from "@/lib/utils";

// Next live appointment of each of these patients — one request for a whole
// list (Queue rows, Search results).
export function usePatientAppointments(patientIds: string[]) {
  const key = Array.from(new Set(patientIds.filter(Boolean))).sort();
  return useQuery({
    // Starts with "appointments" so every appointment change refreshes it.
    queryKey: ["appointments", "by-patient", key],
    queryFn: () => fetchUpcomingAppointmentsByPatient(key),
    enabled: key.length > 0,
    refetchInterval: 30_000,
  });
}

type PatientLite = { id: string; name: string; mobile?: string | null; branch?: string | null; wa_consent?: boolean | null };

// The same buttons for a patient wherever they appear (Queue, Search,
// Profile) — Dr. Yadav, 23 Oct 2026: every patient should get the
// appointment system (new case / offline / online follow-up), be markable the
// moment they enter the clinic or the consultation/call starts, and be
// reschedulable from anywhere.
//   no appointment  -> "Appointment" (book any of the 3 types)
//   booked          -> clinic aaya / call shuru, Reschedule, Cancel
//   arrived         -> consultation shuru
//   started         -> ho gaya
export function PatientApptBar({ patient, appt, className, hideCommon }: { patient: PatientLite; appt?: any; className?: string; hideCommon?: boolean }) {
  const qc = useQueryClient();
  const [booking, setBooking] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const { markArrived, markStarted, markCompleted, cancelAppointment } = useAppointmentActions([["today-queue"], ["flow-today"]]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["appointments"] });

  const btn = "rounded-full border px-2.5 py-1 text-[11px] font-bold inline-flex items-center gap-1";

  if (!appt) {
    return (
      <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
        <button type="button" onClick={() => setBooking(true)} className={cn(btn, "bg-surface border-primary/40 text-primary")}>
          <CalendarPlus className="h-3.5 w-3.5" /> Appointment
        </button>
        {booking && (
          <NewAppointmentModal
            initialPatient={patient}
            onClose={() => setBooking(false)}
            onAdded={() => { refresh(); setBooking(false); }}
          />
        )}
      </div>
    );
  }

  const isToday = appt.appointment_date === todayStr();
  const type = (appt.appointment_type ?? "FOLLOWUP") as ApptType;
  const online = type === "CALL_BACK";
  const dayLabel = isToday
    ? "Aaj"
    : new Date(`${appt.appointment_date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px] font-bold", apptStatusStyle[appt.status] ?? apptStatusStyle.Confirmed)}>
        📅 {dayLabel} {appt.appointment_time} • {apptTypeLabel(type)} • {appt.status === "Arrived" ? "Clinic me aaye" : appt.status === "Started" ? (online ? "Call chal rahi hai" : "Consultation chal rahi hai") : appt.status}
      </span>

      {(appt.status === "Confirmed" || appt.status === "Tentative") && isToday && (online || !hideCommon) && (
        online ? (
          <button type="button" onClick={() => markStarted(appt)} className={cn(btn, "bg-success text-success-foreground border-success")}>
            <PhoneCall className="h-3.5 w-3.5" /> Call shuru
          </button>
        ) : (
          <button type="button" onClick={() => markArrived(appt)} className={cn(btn, "bg-primary text-primary-foreground border-primary")}>
            <DoorOpen className="h-3.5 w-3.5" /> Clinic aaya
          </button>
        )
      )}
      {appt.status === "Arrived" && (
        <button type="button" onClick={() => markStarted(appt)} className={cn(btn, "bg-success text-success-foreground border-success")}>
          <Play className="h-3.5 w-3.5" /> Consultation shuru
        </button>
      )}
      {appt.status === "Started" && (
        <button type="button" onClick={() => markCompleted(appt)} className={cn(btn, "bg-surface border-success/50 text-success")}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Ho gaya
        </button>
      )}

      {appt.status !== "Started" && !hideCommon && (
        <button type="button" onClick={() => setRescheduling(true)} className={cn(btn, "bg-surface border-primary/40 text-primary")}>
          <CalendarClock className="h-3.5 w-3.5" /> Reschedule
        </button>
      )}
      {(appt.status === "Confirmed" || appt.status === "Tentative" || appt.status === "Arrived") && !hideCommon && (
        <button
          type="button"
          onClick={() => { if (window.confirm(`${appt.patient_name ?? "Ye"} appointment cancel karein?`)) cancelAppointment(appt); }}
          className={cn(btn, "bg-surface border-destructive/40 text-destructive")}
        >
          <XCircle className="h-3.5 w-3.5" /> Cancel
        </button>
      )}

      {rescheduling && (
        <RescheduleModal appt={appt} onClose={() => setRescheduling(false)} onRescheduled={() => { refresh(); setRescheduling(false); }} />
      )}
    </div>
  );
}
