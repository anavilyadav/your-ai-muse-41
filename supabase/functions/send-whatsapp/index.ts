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
//
// DELIVERY LOGGING (Phase 3 #26, WhatsApp Delivery Dashboard, 01 Aug 2026):
// this function used to log nothing at all -- success or failure. Every
// real send attempt (sent / failed / skipped for no consent) now writes
// one row to whatsapp_log so the Owner dashboard has something to show.
// Pure validation errors (missing campaignName, missing destination) are
// caller/integration bugs, not delivery attempts, so they are NOT logged.

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

async function logWhatsApp(
  supabaseAdmin: ReturnType<typeof createClient>,
  row: { patient_id: string | null; campaign_name: string; destination: string | null; status: "sent" | "failed" | "skipped_consent"; error_message?: string | null },
) {
  try {
    await supabaseAdmin.from("whatsapp_log").insert(row);
  } catch {
    // Logging must never break the actual send/skip response.
  }
}

// CALLER AUTHENTICATION (Block 2, security hardening).
// This function had no caller check at all and no CORS headers. The URL is
// public and guessable, so anyone who learned it could send arbitrary
// WhatsApp messages to any number on the clinic's AiSensy account, and
// (via patientId) enumerate whether a given patient id exists. It is now
// callable only by:
//   - a signed-in staff member — Authorization: Bearer <supabase session JWT>,
//     validated server-side against Supabase Auth, or
//   - the cron/backend caller — x-cron-secret matching CRON_FUNCTION_SECRET.
// Browsers preflight the JSON POST, hence the OPTIONS handler; without it
// the app would just see "Failed to fetch" (same bug already fixed in
// staff-signin).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-cron-secret",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

async function callerIsAuthorised(req: Request): Promise<boolean> {
  // Path 1 — backend/cron shared secret.
  const cronSecret = Deno.env.get("CRON_FUNCTION_SECRET");
  const got = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret && got.length === cronSecret.length) {
    let diff = 0;
    for (let i = 0; i < cronSecret.length; i++) diff |= got.charCodeAt(i) ^ cronSecret.charCodeAt(i);
    if (diff === 0) return true;
  }
  // Path 2 — a real signed-in staff session. getUser() revalidates the
  // token with Supabase Auth rather than trusting the string.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return false;
  try {
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await anon.auth.getUser();
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }
  if (!(await callerIsAuthorised(req))) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const { campaignName, destination, userName, templateParams, media, patientId, consentConfirmed } = await req.json();
    if (!campaignName) {
      return json({ error: "campaignName required" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let finalDestination = destination;



    if (patientId) {
      const { data: patient, error: pErr } = await supabaseAdmin
        .from("patients")
        .select("mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent")
        .eq("id", patientId)
        .maybeSingle();
      if (pErr) {
        return json({ error: "Patient lookup failed: " + pErr.message }, 500);
      }
      if (!patient) {
        return json({ error: "Patient not found" }, 404);
      }
      if (!patient.wa_consent) {
        await logWhatsApp(supabaseAdmin, {
          patient_id: patientId,
          campaign_name: campaignName,
          destination: patientWhatsAppTarget(patient as any),
          status: "skipped_consent",
        });
        return json({ success: false, skipped: true, error: "No WhatsApp consent on file for this patient" }, 200);
      }
      finalDestination = patientWhatsAppTarget(patient as any);
    } else if (!consentConfirmed) {
      return new Response(
        JSON.stringify({ error: "Either patientId (server-checks consent) or consentConfirmed:true (caller asserts consent) is required" }),
        { status: 400 },
      );
    }

    if (!finalDestination) {
      return json({ error: "destination required" }, 400);
    }

    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (!apiKey) {
      return json({ error: "AISENSY_API_KEY not configured as a secret" }, 500);
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
      await logWhatsApp(supabaseAdmin, {
        patient_id: patientId ?? null,
        campaign_name: campaignName,
        destination: finalDestination,
        status: "failed",
        error_message: data?.message ?? "AiSensy send failed",
      });
      return json({ error: data?.message ?? "AiSensy send failed" }, 400);
    }

    await logWhatsApp(supabaseAdmin, {
      patient_id: patientId ?? null,
      campaign_name: campaignName,
      destination: finalDestination,
      status: "sent",
    });
    return json({ success: true, data }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }, 500);
  }
});
