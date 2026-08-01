// Runs on a schedule (via Supabase Cron / pg_cron — set up in the
// Dashboard, no app code needed for the schedule itself).
//
// Finds all followups due today (or overdue) that haven't had a reminder
// sent yet, and sends each patient a WhatsApp FOLLOWUP_REMINDER via AiSensy,
// then marks them as sent so they're never messaged twice.
//
// Needs an approved AiSensy API Campaign named exactly "FOLLOWUP_REMINDER".
//
// DELIVERY LOGGING (Phase 3 #26, 01 Aug 2026): previously only successful
// sends were recorded, into the generic `interactions` table (no status/
// campaign columns, so a real dashboard couldn't be built off it) —
// failures and no-consent skips were counted in-memory and lost. Every
// outcome now also writes a row to whatsapp_log. The `interactions` write
// is kept as-is (patient timeline / InteractionHistoryModal still reads it).

import { createClient } from "npm:@supabase/supabase-js@2";

// Kept in sync with buildWhatsAppDestination/patientWhatsAppTarget in
// src/lib/db.ts — edge functions are deployed separately so this can't be
// a shared import, but the logic must match.
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

Deno.serve(async () => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AISENSY_API_KEY not configured as a secret" }), { status: 500 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: due, error } = await supabaseAdmin
      .from("followups")
      .select("id, patient_id, due_date, followup_type, patients(name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent)")
      .eq("status", "PENDING")
      .lte("due_date", today)
      .is("reminder_sent_at", null);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    let sent = 0, skipped = 0, failed = 0;
    for (const f of due ?? []) {
      const patient = (f as any).patients;
      if (!patient?.mobile || !patient?.wa_consent) {
        skipped++;
        await supabaseAdmin.from("whatsapp_log").insert({
          patient_id: f.patient_id,
          campaign_name: "FOLLOWUP_REMINDER",
          destination: patient?.mobile ?? null,
          status: "skipped_consent",
        });
        continue;
      }
      try {
        const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            campaignName: "FOLLOWUP_REMINDER",
            destination: patientWhatsAppTarget(patient),
            userName: patient.name,
            source: "YHC-OS",
            templateParams: [patient.name],
          }),
        });
        if (res.ok) {
          await supabaseAdmin.from("followups").update({ reminder_sent_at: new Date().toISOString() }).eq("id", f.id);
          await supabaseAdmin.from("interactions").insert({
            patient_id: f.patient_id,
            type: "whatsapp",
            summary: "FOLLOWUP_REMINDER sent",
          });
          await supabaseAdmin.from("whatsapp_log").insert({
            patient_id: f.patient_id,
            campaign_name: "FOLLOWUP_REMINDER",
            destination: patientWhatsAppTarget(patient),
            status: "sent",
          });
          sent++;
        } else {
          const errData = await res.json().catch(() => ({}));
          await supabaseAdmin.from("whatsapp_log").insert({
            patient_id: f.patient_id,
            campaign_name: "FOLLOWUP_REMINDER",
            destination: patientWhatsAppTarget(patient),
            status: "failed",
            error_message: errData?.message ?? `AiSensy HTTP ${res.status}`,
          });
          failed++;
        }
      } catch (e) {
        await supabaseAdmin.from("whatsapp_log").insert({
          patient_id: f.patient_id,
          campaign_name: "FOLLOWUP_REMINDER",
          destination: patientWhatsAppTarget(patient),
          status: "failed",
          error_message: String(e),
        });
        failed++;
      }
    }
    return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
