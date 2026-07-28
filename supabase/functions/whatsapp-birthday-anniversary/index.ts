// Runs on a schedule (Supabase Cron / pg_cron — daily).
// Finds patients whose dob or anniversary_date matches today's
// month+day (year ignored), sends a WhatsApp wish, and logs it so the
// same person doesn't get wished twice in the same year even if the
// cron runs more than once.
//
// Needs two approved AiSensy API Campaigns: "BIRTHDAY_WISH" and
// "ANNIVERSARY_WISH".

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

async function sendWish(
  supabaseAdmin: any,
  apiKey: string,
  patient: any,
  campaignName: "BIRTHDAY_WISH" | "ANNIVERSARY_WISH",
  logTable: "birthday_greeting_log" | "anniversary_greeting_log",
  year: number,
): Promise<"sent" | "skipped" | "failed"> {
  const { count } = await supabaseAdmin
    .from(logTable)
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patient.id)
    .eq("year", year);
  if ((count ?? 0) > 0) return "skipped";

  try {
    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName,
        destination: patientWhatsAppTarget(patient),
        userName: patient.name,
        source: "YHC-OS",
        templateParams: [patient.name],
      }),
    });
    if (!res.ok) return "failed";
    await supabaseAdmin.from(logTable).insert({ patient_id: patient.id, year });
    await supabaseAdmin.from("interactions").insert({
      patient_id: patient.id,
      type: "whatsapp",
      summary: `${campaignName} sent`,
    });
    return "sent";
  } catch {
    return "failed";
  }
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

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const year = now.getFullYear();

    // dob/anniversary_date are stored as full dates (YYYY-MM-DD) — match
    // on month+day only, year is irrelevant for a recurring wish.
    const { data: patients, error } = await supabaseAdmin
      .from("patients")
      .select("id, name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent, dob, anniversary_date")
      .eq("wa_consent", true);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

    let sent = 0, skipped = 0, failed = 0;
    for (const patient of patients ?? []) {
      if (patient.dob && patient.dob.slice(5, 10) === `${mm}-${dd}`) {
        const r = await sendWish(supabaseAdmin, apiKey, patient, "BIRTHDAY_WISH", "birthday_greeting_log", year);
        if (r === "sent") sent++; else if (r === "skipped") skipped++; else failed++;
      }
      if (patient.anniversary_date && patient.anniversary_date.slice(5, 10) === `${mm}-${dd}`) {
        const r = await sendWish(supabaseAdmin, apiKey, patient, "ANNIVERSARY_WISH", "anniversary_greeting_log", year);
        if (r === "sent") sent++; else if (r === "skipped") skipped++; else failed++;
      }
    }

    return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
