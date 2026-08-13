// Runs on a schedule (via Supabase Cron / pg_cron — set up in the
// Dashboard, no app code needed for the schedule itself).
//
// Finds all WHATSAPP-channel followups due today (or overdue) that haven't
// had a reminder sent yet, and sends each patient a WhatsApp
// FOLLOWUP_REMINDER via AiSensy, then marks them as sent so they're never
// messaged twice.
//
// 04 Aug 2026: added the channel filter — followup_touchpoints/followups
// now distinguish CALL (manual worklist only, e.g. the staged Day 0/5/14/
// 25 post-due chase) from WHATSAPP (also auto-sent here, e.g. Day 2/9/19).
// Before this, every row got an automated WhatsApp regardless of its
// intended channel.
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

    // Edge Functions run in UTC. India has no DST, so IST is always UTC+5:30.
    // Without this shift a cron firing in the IST 12:00am-5:29am window reads
    // yesterday's date and skips (or double-sends) that day's reminders —
    // same offset the other WhatsApp crons already apply.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const today = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

    // WhatsApp master/module switch (Dr. Yadav, 10 Aug 2026).
    const gate = await checkCampaignGate(supabaseAdmin, "FOLLOWUP_REMINDER");
    if (!gate.allowed && gate.reason !== "cap_reached") {
      return new Response(JSON.stringify({ success: true, sent: 0, skipped: 0, failed: 0, disabled: true, reason: gate.reason }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    let budget = gate.budget;

    const { data: due, error } = await supabaseAdmin
      .from("followups")
      .select("id, patient_id, due_date, followup_type, patients(name, mobile, mobile_country_code, whatsapp_number, whatsapp_country_code, wa_consent)")
      .eq("status", "PENDING")
      .eq("channel", "WHATSAPP")
      .lte("due_date", today)
      .is("reminder_sent_at", null);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    let sent = 0, skipped = 0, failed = 0, cappedOut = 0;
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
      if (budget <= 0) {
        cappedOut++;
        await logWhatsAppSkip(supabaseAdmin, {
          patient_id: f.patient_id,
          campaign_name: "FOLLOWUP_REMINDER",
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
    return new Response(JSON.stringify({ success: true, sent, skipped, failed, cappedOut }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
