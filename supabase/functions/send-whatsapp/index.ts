// Sends ONE WhatsApp message via AiSensy. Called from the app whenever a
// single event happens (registration, appointment created, etc.)
//
// Requires AiSensy to have an approved WhatsApp template + API Campaign
// already set up (AiSensy Dashboard -> Campaigns -> Launch campaign ->
// API campaign). The "campaignName" you pass here must match that
// campaign's name exactly.
//
// Called with:
//   { campaignName, destination, userName, templateParams, patientId? }
//
// CONSENT ENFORCEMENT (audit P1-10): the scheduled campaigns
// (whatsapp-daily-reminders etc.) already check patients.wa_consent before
// sending. This ad-hoc function didn't -- it trusted whichever screen called
// it to have already checked, which only some call sites actually did, and
// a future call site could easily forget (same class of bug as the
// AuthGate-forgetting issue fixed elsewhere this session). Now:
//   - if patientId is given, wa_consent is looked up SERVER-SIDE and the
//     send is refused if it's false, no matter what the caller believed.
//     The destination number is also resolved server-side from the patient
//     record (whatsapp_number if set, else mobile) instead of trusting
//     whatever `destination` the caller passed, for the same reason.
//   - if patientId is NOT given (a lead/contact with no patient record
//     yet), the caller must explicitly pass consentConfirmed: true. Missing
//     patientId AND missing consentConfirmed is refused, not defaulted to
//     "send anyway".

import { createClient } from "npm:@supabase/supabase-js@2";

function buildWhatsAppDestination(countryCode: string | null | undefined, localNumber: string | null | undefined): string {
  const cc = (countryCode || "+91").replace(/\D/g, "");
  const digits = (localNumber || "").replace(/\D/g, "");
  if (!digits) return "";
  return cc === "91" ? digits : cc + digits;
}
function patientWhatsAppTarget(p: {
  mobile: string;
  mobile_country_code?: string | null;
  whatsapp_number?: string | null;
  whatsapp_country_code?: string | null;
}): string {
  if (p.whatsapp_number) {
    return buildWhatsAppDestination(p.whatsapp_country_code || p.mobile_country_code, p.whatsapp_number);
  }
  return buildWhatsAppDestination(p.mobile_country_code, p.mobile);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  try {
    const { campaignName, destination, userName, templateParams, media, patientId, consentConfirmed } = await req.json();
    if (!campaignName) {
      return new Response(JSON.stringify({ error: "campaignName required" }), { status: 400 });
    }

    let finalDestination = destination;

    if (patientId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: patient, error: pErr } = await supabaseAdmin
        .from("patients")
        .select("mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent")
        .eq("id", patientId)
        .maybeSingle();
      if (pErr) {
        return new Response(JSON.stringify({ error: "Patient lookup failed: " + pErr.message }), { status: 500 });
      }
      if (!patient) {
        return new Response(JSON.stringify({ error: "Patient not found" }), { status: 404 });
      }
      if (!patient.wa_consent) {
        return new Response(JSON.stringify({ success: false, skipped: true, error: "No WhatsApp consent on file for this patient" }), { status: 200 });
      }
      finalDestination = patientWhatsAppTarget(patient);
    } else if (!consentConfirmed) {
      return new Response(
        JSON.stringify({ error: "Either patientId (server-checks consent) or consentConfirmed:true (caller asserts consent) is required" }),
        { status: 400 },
      );
    }

    if (!finalDestination) {
      return new Response(JSON.stringify({ error: "destination required" }), { status: 400 });
    }

    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AISENSY_API_KEY not configured as a secret" }), { status: 500 });
    }

    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName,
        destination: finalDestination,
        userName: userName ?? "Patient",
        source: "YHC-OS",
        templateParams: templateParams ?? [],
        ...(media ? { media } : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.message ?? "AiSensy send failed" }), { status: 400 });
    }
    return new Response(JSON.stringify({ success: true, data }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
