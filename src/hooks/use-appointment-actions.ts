import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateAppointmentStatus, checkInExistingPatient, normalizeBranchKey } from "@/lib/db";

// Shared between the standalone /appointments page and the Queue's own
// "today's appointments" section (24 Sep 2026 — Dr. Yadav wanted
// Arrive/Cancel/Reschedule usable right from Queue, not just the
// separate Appointments screen) — one real implementation of what
// Arrived/Cancel actually DO, so the two surfaces can never drift apart
// on behavior. `extraInvalidateKeys` lets each caller also refresh its
// own list's query key (e.g. Queue refreshing ["today-queue"] after a
// real check-in) without this hook needing to know about every caller.
export function useAppointmentActions(extraInvalidateKeys: unknown[][] = []) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["appointments"] });
    for (const k of extraInvalidateKeys) qc.invalidateQueries({ queryKey: k });
  };

  // "Arrived" used to just flip a status column — completely disconnected
  // from the real queue/token system, so Reception marked someone Arrived
  // here and then separately redid the whole check-in in Register from
  // scratch. Now it performs the actual check-in.
  const markArrived = async (a: any) => {
    const res = await updateAppointmentStatus(a.id, "Arrived");
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    invalidateAll();

    if (a.patient_id) {
      const branch = normalizeBranchKey(a.branch) || "BAJAJ_NAGAR";
      try {
        const { visit } = await checkInExistingPatient({
          patient_id: a.patient_id,
          branch: branch as "BAJAJ_NAGAR" | "JAGATPURA",
          chief_complaint: a.reason || undefined,
          case_channel: "WALK_IN",
        });
        invalidateAll();
        toast.success(`${a.patient_name} check-in ho gaya — Token ${visit.token_number}`);
      } catch (e: any) {
        toast.warning(`${a.patient_name} arrived mark ho gaya, par check-in nahi hua: ${e?.message ?? e} — Register se manually check-in karo`);
      }
    } else {
      toast.success(`${a.patient_name} arrived — registration poora karo`);
      navigate({
        to: "/register",
        search: { name: a.patient_name ?? "", mobile: a.mobile ?? "", branch: normalizeBranchKey(a.branch) || "" },
      });
    }
  };

  const cancelAppointment = async (a: any) => {
    const previousStatus = a.status;
    const res = await updateAppointmentStatus(a.id, "Cancelled");
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    invalidateAll();
    toast.error(`${a.patient_name} cancelled`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const undoRes = await updateAppointmentStatus(a.id, previousStatus);
          if (undoRes.success) {
            invalidateAll();
            toast.success("Cancel undo ho gaya");
          } else {
            toast.error("Undo nahi hua: " + undoRes.error);
          }
        },
      },
    });
  };

  return { markArrived, cancelAppointment };
}
