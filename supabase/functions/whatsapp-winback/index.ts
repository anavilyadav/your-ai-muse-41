// Runs on a schedule (Supabase Cron / pg_cron — set up once in the
// Dashboard, no app code needed for the schedule itself).
//
// Finds patients whose last_visit_date has crossed a win-back tier
// threshold (60/90/120/150+ days by default, editable in winback_tiers)
// and haven't already been sent that specific tier, sends each one a
// WhatsApp WINBACK message via AiSensy, then logs it so the same tier is
// never sent twice to the same patient.
//
// Needs an approved AiSensy API Campaign named exactly "WINBACK".
//
// DELIVERY LOGGING (Phase 3 #26, 01 Aug 2026): every send attempt (sent or
// failed) now also writes a row to whatsapp_log for the Owner dashboard.
// The `winback_log` dedup table and `interactions` write are unchanged.

import { createClient } from "npm:@supabase/supabase-js@2";

// NOTE ON INLINED HELPERS (10 Aug 2026): cron-auth + whatsapp-gate logic
// below is inlined rather than imported from ../_shared/ — the MCP deploy
// path used for hotfixes in this project couldn't resolve relative
// shared-module imports (bundler looked for _shared/*.ts one level up
// from source/ and didn't find files placed there via the files[] array,
// confirmed live 10 Aug 2026). Same reason buildWhatsAppDestination/
// patientWhatsAppTarget below were never shared imports either.

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

// Edge Functions run in UTC. India has no DST, so IST is always exactly
// UTC+5:30 -- shift the clock by that fixed offset before reading date
// parts, instead of trusting the server's own local calendar date. Without
// this, a cron that fires in the IST 12:00am-5:29am window reads a date
// that's still "yesterday" in UTC, and every day-based comparison
// (cutoffStr here) is off by one for that window.
function istDateNDaysAgoStr(daysAgo: number): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  istNow.setUTCDate(istNow.getUTCDate() - daysAgo);
  return istNow.toISOString().slice(0, 10);
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

    // WhatsApp master/module switch (Dr. Yadav, 10 Aug 2026) — if the whole
    // WINBACK campaign is off, stop here before even querying candidates.
    // A cap (not a full off) still needs the candidate list below to know
    // who to actually send to vs. log as skipped_cap.
    const gate = await checkCampaignGate(supabaseAdmin, "WINBACK");
    if (!gate.allowed && gate.reason !== "cap_reached") {
      return new Response(JSON.stringify({ success: true, sent: 0, skipped: 0, failed: 0, disabled: true, reason: gate.reason }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    let budget = gate.budget;

    const { data: tiers, error: tiersErr } = await supabaseAdmin
      .from("winback_tiers")
      .select("*")
      .eq("active", true)
      .order("days_lapsed", { ascending: true });
    if (tiersErr) return new Response(JSON.stringify({ error: tiersErr.message }), { status: 400 });

    let sent = 0, skipped = 0, failed = 0, cappedOut = 0;

    for (const tier of tiers ?? []) {
      const cutoffStr = istDateNDaysAgoStr(tier.days_lapsed);

      // Candidates: last visit was on/before the cutoff date, so they've
      // crossed this tier's threshold. (last_visit_date null = never had
      // a completed visit yet — not a lapsed patient, skip naturally
      // since the filter won't match null.)
      const { data: candidates, error: candErr } = await supabaseAdmin
        .from("patients")
        .select("id, name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent, last_visit_date")
        .lte("last_visit_date", cutoffStr)
        .eq("wa_consent", true);
      if (candErr) continue;
      if (!candidates || candidates.length === 0) continue;

      // Was one dedup query PER candidate (N+1 — e.g. 500 patients in a
      // tier meant 500 round trips just to check "already sent?"). Now one
      // query for the whole tier: fetch every patient_id already sent this
      // tier, from just the candidate set, and check membership in memory.
      const candidateIds = candidates.map((p: any) => p.id);
      const { data: alreadySent } = await supabaseAdmin
        .from("winback_log")
        .select("patient_id")
        .eq("tier_days", tier.days_lapsed)
        .in("patient_id", candidateIds);
      const alreadySentSet = new Set((alreadySent ?? []).map((r: any) => r.patient_id));

      for (const patient of candidates) {
        if (alreadySentSet.has(patient.id)) { skipped++; continue; }

        if (budget <= 0) {
          cappedOut++;
          await logWhatsAppSkip(supabaseAdmin, {
            patient_id: patient.id,
            campaign_name: "WINBACK",
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
              campaignName: "WINBACK",
              destination: patientWhatsAppTarget(patient),
              userName: patient.name,
              source: "YHC-OS",
              templateParams: [patient.name],
            }),
          });
          if (res.ok) {
            await supabaseAdmin.from("winback_log").insert({ patient_id: patient.id, tier_days: tier.days_lapsed });
            await supabaseAdmin.from("interactions").insert({
              patient_id: patient.id,
              type: "whatsapp",
              summary: `WINBACK sent (${tier.label ?? tier.days_lapsed + "d"})`,
            });
            await supabaseAdmin.from("whatsapp_log").insert({
              patient_id: patient.id,
              campaign_name: "WINBACK",
              destination: patientWhatsAppTarget(patient),
              status: "sent",
            });
            sent++;
          } else {
            const errData = await res.json().catch(() => ({}));
            await supabaseAdmin.from("whatsapp_log").insert({
              patient_id: patient.id,
              campaign_name: "WINBACK",
              destination: patientWhatsAppTarget(patient),
              status: "failed",
              error_message: errData?.message ?? `AiSensy HTTP ${res.status}`,
            });
            failed++;
          }
        } catch (e) {
          await supabaseAdmin.from("whatsapp_log").insert({
            patient_id: patient.id,
            campaign_name: "WINBACK",
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
