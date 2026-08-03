import { supabase } from "./supabase";

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
 *
 * Uses functions.invoke() rather than a bare fetch (Block 2, security
 * hardening): send-whatsapp now requires a real signed-in staff session,
 * and invoke() attaches the current session's bearer token and the apikey
 * header for us. A bare fetch sent neither, so it would now come back 401.
 */
export async function sendWhatsApp(input: SendWhatsAppInput) {
  try {
    const { data, error } = await supabase.functions.invoke("send-whatsapp", {
      body: input,
    });
    if (error) {
      console.warn("WhatsApp send failed:", error.message);
      return { success: false, error: error.message };
    }
    if (data && data.success === false) {
      // Non-2xx isn't the only failure shape — the function returns 200 with
      // success:false when a send is skipped for missing consent.
      console.warn("WhatsApp send not delivered:", data.error);
      return { success: false, error: data.error };
    }
    return { success: true };
  } catch (e) {
    console.warn("WhatsApp send error:", e);
    return { success: false, error: String(e) };
  }
}

