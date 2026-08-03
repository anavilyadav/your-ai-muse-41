// Runs on a schedule (Supabase Cron / pg_cron — daily).
// Checks today's date against the owner-configured `holidays` list.
// If today matches, broadcasts a WhatsApp greeting to every consented
// patient who hasn't already received it (dedup via holiday_greeting_log,
// so a cron re-run or double-trigger never double-sends).
//
// Needs an approved AiSensy API Campaign named exactly "HOLIDAY_GREETING".
//
// DELIVERY LOGGING (Phase 3 #26, 01 Aug 2026): every send attempt (sent or
// failed) now also writes a row to whatsapp_log for the Owner dashboard.
// The `holiday_greeting_log` dedup table and `interactions` write are
// unchanged.

import { requireCronSecret } from "../_shared/cron-auth.ts";
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

// Edge Functions run in UTC. India has no DST, so IST is always exactly
// UTC+5:30 -- shift the clock by that fixed offset before reading today's
// date, instead of trusting the server's own local calendar date. Without
// this, a cron that fires in the IST 12:00am-5:29am window reads a date
// that's still "yesterday" in UTC, and a holiday falling on that boundary
// day gets missed entirely (checked against the wrong date, once, ever).
function istTodayStr(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  // Caller check (see ../_shared/cron-auth.ts): this URL is public, so
  // without it anyone could trigger a full run against real patients.
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AISENSY_API_KEY not configured as a secret" }), { status: 500 });
    }

    const todayStr = istTodayStr();
    const { data: holidays, error: hErr } = await supabaseAdmin
      .from("holidays")
      .select("*")
      .eq("date", todayStr)
      .eq("active", true);
    if (hErr) return new Response(JSON.stringify({ error: hErr.message }), { status: 400 });
    if (!holidays || holidays.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, note: "no holiday today" }), { status: 200 });
    }

    const { data: patients, error: pErr } = await supabaseAdmin
      .from("patients")
      .select("id, name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent")
      .eq("wa_consent", true);
    if (pErr) return new Response(JSON.stringify({ error: pErr.message }), { status: 400 });

    let sent = 0, skipped = 0, failed = 0;
    for (const holiday of holidays) {
      // Was one dedup count() query PER patient PER holiday (N+1 — e.g.
      // 500 consented patients meant 500 round trips just to check
      // "already sent this holiday?"). Now one batched query per holiday:
      // fetch every patient_id already sent this holiday, check
      // membership in memory.
      const allPatientIds = (patients ?? []).map((p: any) => p.id);
      const { data: alreadySent } = await supabaseAdmin
        .from("holiday_greeting_log")
        .select("patient_id")
        .eq("holiday_id", holiday.id)
        .in("patient_id", allPatientIds);
      const alreadySentSet = new Set((alreadySent ?? []).map((r: any) => r.patient_id));

      for (const patient of patients ?? []) {
        if (alreadySentSet.has(patient.id)) { skipped++; continue; }

        try {
          const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey,
              campaignName: "HOLIDAY_GREETING",
              destination: patientWhatsAppTarget(patient),
              userName: patient.name,
              source: "YHC-OS",
              templateParams: [patient.name, holiday.name],
            }),
          });
          if (res.ok) {
            await supabaseAdmin.from("holiday_greeting_log").insert({ patient_id: patient.id, holiday_id: holiday.id });
            await supabaseAdmin.from("interactions").insert({
              patient_id: patient.id,
              type: "whatsapp",
              summary: `${holiday.name} greeting sent`,
            });
            await supabaseAdmin.from("whatsapp_log").insert({
              patient_id: patient.id,
              campaign_name: "HOLIDAY_GREETING",
              destination: patientWhatsAppTarget(patient),
              status: "sent",
            });
            sent++;
          } else {
            const errData = await res.json().catch(() => ({}));
            await supabaseAdmin.from("whatsapp_log").insert({
              patient_id: patient.id,
              campaign_name: "HOLIDAY_GREETING",
              destination: patientWhatsAppTarget(patient),
              status: "failed",
              error_message: errData?.message ?? `AiSensy HTTP ${res.status}`,
            });
            failed++;
          }
        } catch (e) {
          await supabaseAdmin.from("whatsapp_log").insert({
            patient_id: patient.id,
            campaign_name: "HOLIDAY_GREETING",
            destination: patientWhatsAppTarget(patient),
            status: "failed",
            error_message: String(e),
          });
          failed++;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
