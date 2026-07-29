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

// Edge Functions run in UTC. India has no DST, so IST is always exactly
// UTC+5:30 -- shift the clock by that fixed offset before reading month/
// day/year, instead of trusting the server's own local calendar date.
// Without this, a cron that fires in the IST 12:00am-5:29am window reads
// a date that's still "yesterday" in UTC, and birthdays/anniversaries
// falling on that boundary day get missed (or matched a day late).
function istTodayParts(): { mm: string; dd: string; year: number } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return {
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    year: ist.getUTCFullYear(),
  };
}

// Was one dedup count() query PER matching patient PER wish type — N+1.
// Now: caller passes the full candidate id list once, this returns the
// Set of ids already wished this year, checked in memory per patient.
async function fetchAlreadyWishedSet(supabaseAdmin: any, logTable: string, year: number, patientIds: string[]): Promise<Set<string>> {
  if (patientIds.length === 0) return new Set();
  const { data } = await supabaseAdmin
    .from(logTable)
    .select("patient_id")
    .eq("year", year)
    .in("patient_id", patientIds);
  return new Set((data ?? []).map((r: any) => r.patient_id));
}

async function sendWish(
  supabaseAdmin: any,
  apiKey: string,
  patient: any,
  campaignName: "BIRTHDAY_WISH" | "ANNIVERSARY_WISH",
  logTable: "birthday_greeting_log" | "anniversary_greeting_log",
  year: number,
): Promise<"sent" | "failed"> {
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

    const { mm, dd, year } = istTodayParts();

    // dob/anniversary_date are stored as full dates (YYYY-MM-DD) — match
    // on month+day only, year is irrelevant for a recurring wish.
    const { data: patients, error } = await supabaseAdmin
      .from("patients")
      .select("id, name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent, dob, anniversary_date")
      .eq("wa_consent", true);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

    const birthdayMatches = (patients ?? []).filter((p: any) => p.dob && p.dob.slice(5, 10) === `${mm}-${dd}`);
    const anniversaryMatches = (patients ?? []).filter((p: any) => p.anniversary_date && p.anniversary_date.slice(5, 10) === `${mm}-${dd}`);

    // Two batched dedup queries total (one per log table) instead of one
    // count() query per matching patient per wish type.
    const alreadyWishedBirthday = await fetchAlreadyWishedSet(supabaseAdmin, "birthday_greeting_log", year, birthdayMatches.map((p: any) => p.id));
    const alreadyWishedAnniversary = await fetchAlreadyWishedSet(supabaseAdmin, "anniversary_greeting_log", year, anniversaryMatches.map((p: any) => p.id));

    let sent = 0, skipped = 0, failed = 0;
    for (const patient of birthdayMatches) {
      if (alreadyWishedBirthday.has(patient.id)) { skipped++; continue; }
      const r = await sendWish(supabaseAdmin, apiKey, patient, "BIRTHDAY_WISH", "birthday_greeting_log", year);
      if (r === "sent") sent++; else failed++;
    }
    for (const patient of anniversaryMatches) {
      if (alreadyWishedAnniversary.has(patient.id)) { skipped++; continue; }
      const r = await sendWish(supabaseAdmin, apiKey, patient, "ANNIVERSARY_WISH", "anniversary_greeting_log", year);
      if (r === "sent") sent++; else failed++;
    }

    return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
