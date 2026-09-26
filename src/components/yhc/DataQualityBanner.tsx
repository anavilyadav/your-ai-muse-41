import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchPatientDataQualityFlags, type PatientDataQualityFlags } from "@/lib/db";

// Inline Data Quality warning (25 Sep 2026, Dr. Yadav) — shows up wherever
// staff already has a specific patient's record open (Register check-in,
// Payment, Doctor consult, Patient Profile) instead of expecting anyone to
// separately work through the bulk Data Quality lists. `onEdit`, when
// given, opens that screen's own edit modal directly (Patient Profile
// already has one); otherwise this links out to the profile to fix it
// there. Renders nothing once the patient has no open flags, and nothing
// at all while still loading (no flash of a false-positive banner).
export function DataQualityBanner({
  patient,
  onEdit,
}: {
  patient: {
    id: string;
    name?: string | null;
    mobile?: string | null;
    card_series?: string | null;
    card_register?: string | null;
    card_number?: string | null;
    mobile_confirmed?: boolean | null;
    whatsapp_confirmed?: boolean | null;
    whatsapp_number?: string | null;
  } | null | undefined;
  onEdit?: () => void;
}) {
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";
  const [flags, setFlags] = useState<PatientDataQualityFlags | null>(null);

  useEffect(() => {
    setFlags(null);
    if (!patient?.id) return;
    let cancelled = false;
    fetchPatientDataQualityFlags(patient).then((f) => { if (!cancelled) setFlags(f); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id, patient?.name, patient?.mobile, patient?.card_series, patient?.card_register, patient?.card_number, patient?.mobile_confirmed, patient?.whatsapp_confirmed]);

  if (!flags || !flags.hasAny) return null;

  const items: string[] = [];
  if (flags.incompleteName) items.push("Naam adhoora hai");
  if (flags.missingMobile) items.push("Mobile number nahi hai — patient khud aaye ya call kare tab bhar dena");
  if (flags.missingCard) items.push("Card number nahi hai");
  if (flags.partialCard) items.push("Card number adhoora hai");
  if (flags.unconfirmedNumber) items.push("Number confirm nahi hai");
  if (flags.sharedMobile) items.push("Ye mobile kisi aur patient ke saath bhi hai");
  if (flags.possibleDuplicate) items.push("Isi naam+mobile ka doosra record bhi hai");

  // Only name/card/number-confirm/missing-mobile/missing-card are self-
  // fixable from here — shared-mobile and possible-duplicate need the
  // Owner's family-link/merge tools, so those two stay informational for
  // non-Owner staff.
  const selfFixable = flags.incompleteName || flags.partialCard || flags.unconfirmedNumber || flags.missingMobile || flags.missingCard;

  return (
    <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-2.5 mb-3">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-destructive">Is patient ki profile me kami hai</p>
          <p className="text-[11px] text-destructive/90 mt-0.5">{items.join(" • ")}</p>
        </div>
      </div>
      {selfFixable && (
        onEdit ? (
          <button
            onClick={onEdit}
            className="mt-2 w-full rounded-lg bg-destructive text-destructive-foreground text-[11px] font-bold py-1.5"
          >
            Abhi Theek Karo
          </button>
        ) : (
          <Link
            to="/patient/$id"
            params={{ id: patient!.id }}
            className="mt-2 block w-full text-center rounded-lg bg-destructive text-destructive-foreground text-[11px] font-bold py-1.5"
          >
            Profile Khol Ke Theek Karo
          </Link>
        )
      )}
      {!selfFixable && isOwner && flags.sharedMobile && (
        <Link
          to="/owner/fix-shared-mobiles"
          className="mt-2 block w-full text-center rounded-lg bg-destructive text-destructive-foreground text-[11px] font-bold py-1.5"
        >
          Shared Mobile Review Karo
        </Link>
      )}
    </div>
  );
}
