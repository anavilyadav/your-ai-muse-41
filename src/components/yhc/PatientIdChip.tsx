import { formatCardNumber, systemIdLabel } from "@/lib/db";
import { cn } from "@/lib/utils";

// The card number (given by the case-taking doctor) next to a patient's name,
// wherever the name is listed (Dr. Yadav, 26 Oct 2026). A patient with no card
// yet shows the app number as SYS-xxxxx instead.
export function PatientIdChip({
  patient,
  className,
}: {
  patient: { card_series?: string | null; card_register?: string | null; card_number?: string | null; patient_code?: string | null } | null | undefined;
  className?: string;
}) {
  if (!patient) return null;
  const card = formatCardNumber(patient.card_series, patient.card_register, patient.card_number);
  if (!card && !patient.patient_code) return null;
  return card ? (
    <span className={cn("shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30", className)}>{card}</span>
  ) : (
    <span className={cn("shrink-0 text-[10px] text-muted-foreground", className)}>{systemIdLabel(patient.patient_code)}</span>
  );
}
