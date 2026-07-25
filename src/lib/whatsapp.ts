const SEND_URL = "https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/send-whatsapp";

export interface SendWhatsAppInput {
  campaignName: "REGISTRATION_CONFIRM" | "APPOINTMENT_REMINDER" | "FOLLOWUP_REMINDER";
  destination: string; // 10-digit mobile
  userName: string;
  templateParams?: string[];
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
