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
async function checkCampaignGate(supabaseAdmin: any, campaignName: string): Promise<{ allowed: boolean; budget: number; reason: "master_off" | "module_off" | "cap_reached" | null; dailyCap: number | null }> {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "whatsapp_controls").maybeSingle();
  let controls: { masterEnabled: boolean; modules: Record<string, WhatsAppModuleControl> } = { masterEnabled: true, modules: {} };
  if (data?.value) {
    try {
      const parsed = JSON.parse(data.value);
      controls = { masterEnabled: parsed.masterEnabled ?? true, modules: parsed.modules ?? {} };
    } catch { /* keep defaults */ }
  }
  if (!controls.masterEnabled) return { allowed: false, budget: 0, reason: "master_off", dailyCap: null };
  const mod = controls.modules[campaignName] ?? DEFAULT_MODULE;
  if (!mod.enabled) return { allowed: false, budget: 0, reason: "module_off", dailyCap: mod.dailyCap };
  if (mod.dailyCap == null) return { allowed: true, budget: Infinity, reason: null, dailyCap: null };
  const todayStartUtc = new Date(`${istTodayDate()}T00:00:00+05:30`).toISOString();
  const { count } = await supabaseAdmin.from("whatsapp_log").select("id", { count: "exact", head: true }).eq("campaign_name", campaignName).eq("status", "sent").gte("created_at", todayStartUtc);
  const budget = Math.max(0, mod.dailyCap - (count ?? 0));
  if (budget <= 0) return { allowed: false, budget: 0, reason: "cap_reached", dailyCap: mod.dailyCap };
  return { allowed: true, budget, reason: null, dailyCap: mod.dailyCap };
}
async function logWhatsAppSkip(supabaseAdmin: any, row: { patient_id: string | null; campaign_name: string; destination: string | null; reason: "master_off" | "module_off" | "cap_reached"; dailyCap?: number | null }) {
  try {
    await supabaseAdmin.from("whatsapp_log").insert({
      patient_id: row.patient_id,
      campaign_name: row.campaign_name,
      destination: row.destination,
      status: row.reason === "cap_reached" ? "skipped_cap" : "skipped_disabled",
      error_message: row.reason === "master_off" ? "WhatsApp master switch OFF" : row.reason === "module_off" ? `${row.campaign_name} switch OFF` : `Daily cap reached (${row.dailyCap ?? "?"}/day for ${row.campaign_name})`,
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

    // WhatsApp master/module switch (Dr. Yadav, 10 Aug 2026) — this is the
    // highest-blast-radius campaign (broadcasts to EVERY consented patient
    // at once), so checking before the patient query matters most here.
    const gate = await checkCampaignGate(supabaseAdmin, "HOLIDAY_GREETING");
    if (!gate.allowed && gate.reason !== "cap_reached") {
      return new Response(JSON.stringify({ success: true, sent: 0, skipped: 0, failed: 0, disabled: true, reason: gate.reason }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    let budget = gate.budget;

    const { data: patients, error: pErr } = await supabaseAdmin
      .from("patients")
      .select("id, name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent")
      .eq("wa_consent", true);
    if (pErr) return new Response(JSON.stringify({ error: pErr.message }), { status: 400 });

    let sent = 0, skipped = 0, failed = 0, cappedOut = 0;
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

        if (budget <= 0) {
          cappedOut++;
          await logWhatsAppSkip(supabaseAdmin, {
            patient_id: patient.id,
            campaign_name: "HOLIDAY_GREETING",
            destination: patientWhatsAppTarget(patient),
            reason: "cap_reached",
            dailyCap: gate.dailyCap,
          });
          continue;
        }
        budget--;

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

    return new Response(JSON.stringify({ success: true, sent, skipped, failed, cappedOut }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
