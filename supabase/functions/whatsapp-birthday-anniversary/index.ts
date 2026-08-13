// Runs on a schedule (Supabase Cron / pg_cron — daily).
// Finds patients whose dob or anniversary_date matches today's
// month+day (year ignored), sends a WhatsApp wish, and logs it so the
// same person doesn't get wished twice in the same year even if the
// cron runs more than once.
//
// Needs two approved AiSensy API Campaigns: "BIRTHDAY_WISH" and
// "ANNIVERSARY_WISH".
//
// DELIVERY LOGGING (Phase 3 #26, 01 Aug 2026): every send attempt (sent or
// failed) now also writes a row to whatsapp_log for the Owner dashboard.
// The birthday/anniversary dedup tables and `interactions` write are
// unchanged.

import { createClient } from "npm:@supabase/supabase-js@2";

// NOTE ON INLINED HELPERS (10 Aug 2026): see whatsapp-winback/index.ts —
// the MCP deploy path used for hotfixes couldn't resolve relative
// ../_shared/ imports, so this logic is inlined here instead.

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function requireCronSecret(req: Request): Response | null {
  const expected = Deno.env.get("CRON_FUNCTION_SECRET");
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected) {
    return new Response(JSON.stringify({ error: "Unauthorized: CRON_FUNCTION_SECRET not configured" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  if (!constantTimeEqual(got, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  return null;
}

interface WhatsAppModuleControl { enabled: boolean; dailyCap: number | null }
const DEFAULT_MODULE: WhatsAppModuleControl = { enabled: true, dailyCap: null };
function istTodayDate(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
async function checkCampaignGate(supabaseAdmin: any, campaignName: string): Promise<{ allowed: boolean; budget: number; reason: "master_off" | "module_off" | "cap_reached" | null }> {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "whatsapp_controls").maybeSingle();
  let controls: { masterEnabled: boolean; modules: Record<string, WhatsAppModuleControl> } = { masterEnabled: true, modules: {} };
  if (data?.value) {
    try {
      const parsed = JSON.parse(data.value);
      controls = { masterEnabled: parsed.masterEnabled ?? true, modules: parsed.modules ?? {} };
    } catch { /* keep defaults */ }
  }
  if (!controls.masterEnabled) return { allowed: false, budget: 0, reason: "master_off" };
  const mod = controls.modules[campaignName] ?? DEFAULT_MODULE;
  if (!mod.enabled) return { allowed: false, budget: 0, reason: "module_off" };
  if (mod.dailyCap == null) return { allowed: true, budget: Infinity, reason: null };
  const todayStartUtc = new Date(`${istTodayDate()}T00:00:00+05:30`).toISOString();
  const { count } = await supabaseAdmin.from("whatsapp_log").select("id", { count: "exact", head: true }).eq("campaign_name", campaignName).eq("status", "sent").gte("created_at", todayStartUtc);
  const budget = Math.max(0, mod.dailyCap - (count ?? 0));
  if (budget <= 0) return { allowed: false, budget: 0, reason: "cap_reached" };
  return { allowed: true, budget, reason: null };
}
async function logWhatsAppSkip(supabaseAdmin: any, row: { patient_id: string | null; campaign_name: string; destination: string | null; reason: "master_off" | "module_off" | "cap_reached" }) {
  try {
    await supabaseAdmin.from("whatsapp_log").insert({
      patient_id: row.patient_id,
      campaign_name: row.campaign_name,
      destination: row.destination,
      status: row.reason === "cap_reached" ? "skipped_cap" : "skipped_disabled",
      error_message: row.reason === "master_off" ? "WhatsApp master switch OFF" : row.reason === "module_off" ? `${row.campaign_name} switch OFF` : "Daily send cap reached",
    });
  } catch { /* logging must never break the skip/send response */ }
}

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

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
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
  const destination = patientWhatsAppTarget(patient);
  try {
    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName,
        destination,
        userName: patient.name,
        source: "YHC-OS",
        templateParams: [patient.name],
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      await supabaseAdmin.from("whatsapp_log").insert({
        patient_id: patient.id,
        campaign_name: campaignName,
        destination,
        status: "failed",
        error_message: errData?.message ?? `AiSensy HTTP ${res.status}`,
      });
      return "failed";
    }
    await supabaseAdmin.from(logTable).insert({ patient_id: patient.id, year });
    await supabaseAdmin.from("interactions").insert({
      patient_id: patient.id,
      type: "whatsapp",
      summary: `${campaignName} sent`,
    });
    await supabaseAdmin.from("whatsapp_log").insert({
      patient_id: patient.id,
      campaign_name: campaignName,
      destination,
      status: "sent",
    });
    return "sent";
  } catch (e) {
    await supabaseAdmin.from("whatsapp_log").insert({
      patient_id: patient.id,
      campaign_name: campaignName,
      destination,
      status: "failed",
      error_message: String(e),
    });
    return "failed";
  }
}

Deno.serve(async (req) => {
  // Caller check: this URL is public, so without it anyone could trigger
  // a full run against real patients.
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

    const { mm, dd, year } = istTodayParts();

    // Phase 1 #10: someone born/married on Feb 29 would otherwise only
    // ever get wished once every 4 years, since "today" never equals
    // "02-29" in a non-leap year. Convention used here: wish them on
    // Feb 28 instead, in years where Feb 29 doesn't exist. matchDays is
    // normally just today's own month-day, with "02-29" added to it
    // specifically when today is Feb 28 of a non-leap year.
    const matchDays = [`${mm}-${dd}`];
    if (mm === "02" && dd === "28" && !isLeapYear(year)) {
      matchDays.push("02-29");
    }

    // dob/anniversary_date are stored as full dates (YYYY-MM-DD) — match
    // on month+day only, year is irrelevant for a recurring wish.
    const { data: patients, error } = await supabaseAdmin
      .from("patients")
      .select("id, name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent, dob, anniversary_date")
      .eq("wa_consent", true);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

    const birthdayMatches = (patients ?? []).filter((p: any) => p.dob && matchDays.includes(p.dob.slice(5, 10)));
    const anniversaryMatches = (patients ?? []).filter((p: any) => p.anniversary_date && matchDays.includes(p.anniversary_date.slice(5, 10)));

    // Two batched dedup queries total (one per log table) instead of one
    // count() query per matching patient per wish type.
    const alreadyWishedBirthday = await fetchAlreadyWishedSet(supabaseAdmin, "birthday_greeting_log", year, birthdayMatches.map((p: any) => p.id));
    const alreadyWishedAnniversary = await fetchAlreadyWishedSet(supabaseAdmin, "anniversary_greeting_log", year, anniversaryMatches.map((p: any) => p.id));

    // WhatsApp master/module switch (Dr. Yadav, 10 Aug 2026) — checked
    // per-campaign since Owner might turn off birthday wishes but keep
    // anniversary wishes on (or vice versa), or cap one differently.
    const birthdayGate = await checkCampaignGate(supabaseAdmin, "BIRTHDAY_WISH");
    const anniversaryGate = await checkCampaignGate(supabaseAdmin, "ANNIVERSARY_WISH");
    let birthdayBudget = birthdayGate.allowed ? birthdayGate.budget : 0;
    let anniversaryBudget = anniversaryGate.allowed ? anniversaryGate.budget : 0;

    let sent = 0, skipped = 0, failed = 0, cappedOut = 0;
    for (const patient of birthdayMatches) {
      if (alreadyWishedBirthday.has(patient.id)) { skipped++; continue; }
      if (!birthdayGate.allowed && birthdayGate.reason !== "cap_reached") continue; // module/master off — not even worth logging per-patient
      if (birthdayBudget <= 0) {
        cappedOut++;
        await logWhatsAppSkip(supabaseAdmin, { patient_id: patient.id, campaign_name: "BIRTHDAY_WISH", destination: null, reason: "cap_reached" });
        continue;
      }
      birthdayBudget--;
      const r = await sendWish(supabaseAdmin, apiKey, patient, "BIRTHDAY_WISH", "birthday_greeting_log", year);
      if (r === "sent") sent++; else failed++;
    }
    for (const patient of anniversaryMatches) {
      if (alreadyWishedAnniversary.has(patient.id)) { skipped++; continue; }
      if (!anniversaryGate.allowed && anniversaryGate.reason !== "cap_reached") continue;
      if (anniversaryBudget <= 0) {
        cappedOut++;
        await logWhatsAppSkip(supabaseAdmin, { patient_id: patient.id, campaign_name: "ANNIVERSARY_WISH", destination: null, reason: "cap_reached" });
        continue;
      }
      anniversaryBudget--;
      const r = await sendWish(supabaseAdmin, apiKey, patient, "ANNIVERSARY_WISH", "anniversary_greeting_log", year);
      if (r === "sent") sent++; else failed++;
    }

    return new Response(JSON.stringify({ success: true, sent, skipped, failed, cappedOut }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
