import { SUPABASE_URL } from "./supabase";

const SEND_URL = `${SUPABASE_URL}/functions/v1/send-whatsapp`;

export interface SendWhatsAppInput {
  campaignName: "REGISTRATION_CONFIRM" | "APPOINTMENT_REMINDER" | "FOLLOWUP_REMINDER";
  destination: string; // 10-digit mobile — used only as a fallback if patientId isn't given
  userName: string;
  templateParams?: string[];
  // Consent (audit P1-10) is now checked server-side against patients.wa_consent
  // when patientId is passed — pass it whenever the send is for a known patient.
  patientId?: string;
  // Only for sends with no patient record yet (e.g. a fresh lead) — the edge
  // function refuses the send if neither this nor patientId is present.
  consentConfirmed?: boolean;
}

/**
 * Fire-and-forget WhatsApp send. Never throws — logs and swallows errors so
 * a WhatsApp hiccup never blocks registration/appointment flows.
 */
export async function sendWhatsApp(input: SendWhatsAppInput) {
  try {
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("WhatsApp send failed:", data?.error);
      return { success: false, error: data?.error };
    }
    return { success: true };
  } catch (e) {
    console.warn("WhatsApp send error:", e);
    return { success: false, error: String(e) };
  }
}
