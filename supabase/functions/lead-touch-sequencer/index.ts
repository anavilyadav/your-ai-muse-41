// Runs every 30 min (cron, see migration 0086). Sends automated touches
// 2-5 of the lead WhatsApp sequence — touch 1 (LEAD_WELCOME) is sent at
// lead-creation time by justdial-lead-webhook / external-lead-webhook /
// meta-leadgen-webhook / sync-justdial-leads, which also set
// leads.auto_touch_count = 1 right after creating the row.
//
// TAPERING SCHEDULE (days since leads.created_at), Dr. Yadav's call after
// weighing cold-calling's usual 7-10 touches against this channel's very
// different mechanics (every send risks the shared WhatsApp number's Meta
// quality rating, costs money per message, and needs a pre-approved
// template — none of which apply to a human re-dialling a number):
//   touch 2 — day 2       touch 3 — day 5
//   touch 4 — day 10      touch 5 — day 18 (final — sequence ends here)
// Higher-frequency persistence is meant to come from human calling (Call
// Desk / complaint-call), not from stacking more automated WhatsApp sends.
//
// STOP CONDITIONS (context-aware, not blind blasting) — a lead is skipped
// entirely, not just this run, the moment any of these become true:
//   - dnd = true
//   - status in ('CONVERTED','LOST')
//   - call_count > 0 — a HUMAN has logged a call with this lead. Once a
//     staff member has actually talked to them, the automated sequence
//     stands down and lets the normal Manage panel (stage/quality/
//     follow-up date) drive things — an automated nudge arriving an hour
//     after a real conversation would look like the clinic wasn't
//     listening, the opposite of what this is for.
//   - last_inbound_at is set — the lead has REPLIED (handled by
//     aisensy-whatsapp-status, migration 0087's Option B). A reply means a
//     real conversation has started on WhatsApp itself; same reasoning as
//     call_count, just a different channel.
//   - auto_touch_count >= 5 — sequence exhausted.
//
// Needs 4 approved AiSensy API Campaigns named exactly LEAD_TOUCH_2,
// LEAD_TOUCH_3, LEAD_TOUCH_4, LEAD_TOUCH_5 — draft wording was given to
// Dr. Yadav alongside this file for him to review/submit; each is written
// factual/informational (no guaranteed-outcome or urgency language — see
// the NCH 29 Jan 2026 BERH circular note in db.ts next to
// DEFAULT_LEAD_WHATSAPP_TEMPLATES) with {{1}}=name, {{2}}=a short
// disease-interest phrase. ALL FOUR modules were registered disabled by
// default in whatsapp_controls (migration 0086) — this function sends
// nothing until Owner turns each one on individually from Owner >
// WhatsApp, once its template is approved and reviewed.

import { createClient } from "npm:@supabase/supabase-js@2";

function requireCronSecret(req: Request): Response | null {
  const expected = Deno.env.get("CRON_FUNCTION_SECRET");
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected) {
    return new Response(JSON.stringify({ error: "Unauthorized: CRON_FUNCTION_SECRET not configured" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const okLen = got.length === expected.length;
  let diff = okLen ? 0 : 1;
  if (okLen) for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) {
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
async function checkCampaignGate(supabaseAdmin: any, campaignName: string): Promise<{ allowed: boolean; reason: string | null }> {
  const { data, error } = await supabaseAdmin.from("settings").select("value").eq("key", "whatsapp_controls").maybeSingle();
  if (error) return { allowed: false, reason: "settings_error" };
  let controls: { masterEnabled: boolean; modules: Record<string, WhatsAppModuleControl> } = { masterEnabled: true, modules: {} };
  if (data?.value) {
    try {
      const parsed = JSON.parse(data.value);
      controls = { masterEnabled: parsed.masterEnabled ?? true, modules: parsed.modules ?? {} };
    } catch { /* keep defaults */ }
  }
  if (!controls.masterEnabled) return { allowed: false, reason: "master_off" };
  const mod = controls.modules[campaignName] ?? DEFAULT_MODULE;
  if (!mod.enabled) return { allowed: false, reason: "module_off" };
  if (mod.dailyCap == null) return { allowed: true, reason: null };
  const todayStartUtc = new Date(`${istTodayDate()}T00:00:00+05:30`).toISOString();
  const { count } = await supabaseAdmin.from("whatsapp_log").select("id", { count: "exact", head: true }).eq("campaign_name", campaignName).eq("status", "sent").gte("created_at", todayStartUtc);
  if ((count ?? 0) >= mod.dailyCap) return { allowed: false, reason: "cap_reached" };
  return { allowed: true, reason: null };
}

// Same best-effort field-guessing as send-whatsapp/index.ts — see that
// file's comment for why AiSensy's send-response message-id field isn't
// confirmed from their public docs. Kept identical here so
// aisensy-whatsapp-status's matching (by message_id, falling back to
// destination+recency) works the same way for lead touches as for every
// other campaign.
function extractMessageId(data: any): string | null {
  return data?.messages?.[0]?.id ?? data?.messageId ?? data?.data?.messageId ?? data?.data?.messages?.[0]?.id ?? data?.id ?? null;
}

// touch N's campaign + how many days after created_at it's due, keyed by
// the lead's CURRENT auto_touch_count (i.e. "touches done so far").
const TOUCH_SCHEDULE: Record<number, { campaign: string; offsetDays: number }> = {
  1: { campaign: "LEAD_TOUCH_2", offsetDays: 2 },
  2: { campaign: "LEAD_TOUCH_3", offsetDays: 5 },
  3: { campaign: "LEAD_TOUCH_4", offsetDays: 10 },
  4: { campaign: "LEAD_TOUCH_5", offsetDays: 18 },
};

const MAX_CANDIDATES = 500; // query-side cap, same spirit as this project's other cron functions

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: candidates, error } = await supabaseAdmin
      .from("leads")
      .select("id, name, mobile, disease_interest, auto_touch_count, created_at")
      .eq("is_deleted", false)
      .eq("dnd", false)
      .eq("call_count", 0)
      .is("last_inbound_at", null)
      .not("status", "in", "(CONVERTED,LOST)")
      .gte("auto_touch_count", 1)
      .lt("auto_touch_count", 5)
      .limit(MAX_CANDIDATES);
    if (error) throw error;

    const now = Date.now();
    let sent = 0, failed = 0, skippedGate = 0;

    for (const lead of candidates ?? []) {
      const step = TOUCH_SCHEDULE[lead.auto_touch_count as 1 | 2 | 3 | 4];
      if (!step) continue;
      const dueAt = new Date(lead.created_at).getTime() + step.offsetDays * 24 * 60 * 60 * 1000;
      if (now < dueAt) continue; // not due yet — left as-is, picked up by a later run

      const gate = await checkCampaignGate(supabaseAdmin, step.campaign);
      if (!gate.allowed) {
        skippedGate++;
        continue; // auto_touch_count NOT advanced — retried automatically once un-gated
      }

      const apiKey = Deno.env.get("AISENSY_API_KEY");
      if (!apiKey) { skippedGate++; continue; }

      // No leading "aapki" in the fallback — every approved template
      // sentence already has "aapki" right before {{2}} (see the draft
      // wording given to Dr. Yadav), so "aapki aapki health concern" would
      // read as a stutter when disease_interest is blank.
      const diseaseParam = (lead.disease_interest ?? "").trim() || "health concern";
      let status: "sent" | "failed" = "sent";
      let messageId: string | null = null;
      let providerResponse: unknown = null;
      let errorMessage: string | null = null;
      try {
        const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            campaignName: step.campaign,
            destination: lead.mobile,
            userName: lead.name,
            source: "YHC-OS",
            templateParams: [lead.name, diseaseParam],
          }),
        });
        const data = await res.json().catch(() => ({}));
        providerResponse = data;
        if (res.ok) {
          messageId = extractMessageId(data);
          sent++;
        } else {
          status = "failed";
          errorMessage = data?.message ?? "AiSensy send failed";
          failed++;
        }
      } catch (e) {
        status = "failed";
        errorMessage = String(e);
        failed++;
      }

      await supabaseAdmin.from("whatsapp_log").insert({
        patient_id: null,
        campaign_name: step.campaign,
        destination: lead.mobile,
        status,
        error_message: errorMessage,
        message_id: messageId,
        provider_response: providerResponse,
      });
      await supabaseAdmin.from("interactions").insert({
        lead_id: lead.id,
        type: "whatsapp",
        summary: `${step.campaign} sent (auto-sequence touch ${lead.auto_touch_count + 1}/5)${status === "failed" ? ` — FAILED: ${errorMessage}` : ""}`,
      });
      // Advance regardless of sent/failed — a delivery failure (bad
      // number, etc.) shouldn't retry-storm every 30 min forever; it's
      // logged above for the Owner > WhatsApp dashboard to show.
      await supabaseAdmin.from("leads").update({ auto_touch_count: lead.auto_touch_count + 1 }).eq("id", lead.id);
    }

    return new Response(JSON.stringify({ success: true, candidates: (candidates ?? []).length, sent, failed, skippedGate }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 200 });
  }
});
