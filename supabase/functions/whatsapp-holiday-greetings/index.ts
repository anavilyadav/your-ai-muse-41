// Runs on a schedule (Supabase Cron / pg_cron — daily).
// Checks today's date against the owner-configured `holidays` list.
// If today matches, broadcasts a WhatsApp greeting to every consented
// patient who hasn't already received it (dedup via holiday_greeting_log,
// so a cron re-run or double-trigger never double-sends).
//
// Needs an approved AiSensy API Campaign named exactly "HOLIDAY_GREETING".

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

    const todayStr = new Date().toISOString().slice(0, 10);
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
      for (const patient of patients ?? []) {
        const { count } = await supabaseAdmin
          .from("holiday_greeting_log")
          .select("id", { count: "exact", head: true })
          .eq("patient_id", patient.id)
          .eq("holiday_id", holiday.id);
        if ((count ?? 0) > 0) { skipped++; continue; }

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
            sent++;
          } else {
            failed++;
          }
        } catch {
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
