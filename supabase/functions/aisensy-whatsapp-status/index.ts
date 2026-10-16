// Receives WhatsApp delivery/read status callbacks AND inbound message
// replies from AiSensy — originally built 17 Sep 2026 for delivery/read
// tracking only; extended 13 Oct 2026 (Dr. Yadav's "Option B") to also
// react to a LEAD replying, since nothing in the system picked up inbound
// replies before this — they just sat unread in WhatsApp until a staff
// member happened to check.
//
// AiSensy passes through Meta's own WhatsApp Cloud API webhook shape
// unmodified. A single POST can carry BOTH arrays in the same
// entry[].changes[].value object:
//   .statuses[]  — { id: "wamid...", status: "delivered"|"read"|"failed", recipient_id, errors? }
//   .messages[]  — { from, id, timestamp, type, text: { body } }
// Confirmed against AiSensy's own docs (aisensy.stoplight.io) for the
// statuses[] shape; messages[] follows Meta's standard, well-documented
// Cloud API webhook format, which AiSensy explicitly passes through
// unmodified per the same docs — not re-verified against an AiSensy-
// specific example of a live inbound payload (none was available), so
// double-check the very first real inbound reply's logged
// provider-payload-shape once this is live, in case AiSensy wraps it
// differently than Meta's own format.
//
// SETUP NEEDED IN AISENSY'S OWN DASHBOARD (cannot be done from here, and
// NOT CONFIRMED DONE — see note below):
//   1. Project settings -> Webhooks -> add this function's URL.
//   2. Set a webhook shared secret there, and set the SAME value as this
//      project's AISENSY_WEBHOOK_SECRET edge function secret.
// Without both sides matching, every callback gets rejected with 401.
// CHECKED LIVE 13 Oct 2026: whatsapp_log has 393 rows logged from actual
// sends, but delivered_at/read_at are null on every single one — strong
// evidence this webhook has NEVER actually received a callback from
// AiSensy, i.e. step 1/2 above were likely never completed. Inbound-reply
// handling (and delivery/read tracking) won't do anything until that
// one-time dashboard step is done.
//
// This endpoint takes no Supabase Auth (verify_jwt: false) -- AiSensy is
// not a signed-in user, authenticity comes entirely from the HMAC
// signature below, per AiSensy's own webhook docs.

import { createClient } from "npm:@supabase/supabase-js@2";

async function verifySignature(rawBody: string, receivedSignature: string, secret: string): Promise<boolean> {
  if (!receivedSignature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare -- this is a security boundary, not just a diff check.
  if (computed.length !== receivedSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ receivedSignature.charCodeAt(i);
  return diff === 0;
}

interface StatusEntry {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { title?: string; message?: string }[];
}

interface MessageEntry {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
}

// Inlined checkCampaignGate/extractMessageId — same pattern as every other
// WhatsApp-sending function in this project (MCP deploy path can't
// resolve relative _shared/ imports).
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
function extractMessageId(data: any): string | null {
  return data?.messages?.[0]?.id ?? data?.messageId ?? data?.data?.messageId ?? data?.data?.messages?.[0]?.id ?? data?.id ?? null;
}

// Keyword classification — deliberately simple/rule-based, not an LLM:
// every possible reply is pre-written and Dr.-Yadav-reviewed (see the
// wording given alongside this file), so nothing can improvise clinical-
// sounding or guaranteed-outcome language the way a generic AI chatbot
// might (the NCH/NMC concern raised earlier in this project).
//
// Three tiers, checked in this order — found by testing real phrasings
// (see /tmp/classify_test2.mjs output, 13 Oct 2026): a flat "booking
// checked first" list was misclassifying "Fees kitni hai consultation ki"
// as BOOKING_INTENT, because "consult" matches inside "consultation" even
// when the actual question is about price. STRONG_BOOKING only has clear
// action-intent phrases ("book", "call me", "slot") that don't co-occur
// with price/timing questions in practice. INFO_KEYWORDS (price/timing/
// address words) is checked next, so a fee question wins even when
// "appointment"/"consultation" is also in the sentence. SOFT_BOOKING
// ("appointment", "consult" alone) only applies once no clearer signal
// matched — e.g. "Mujhe consultation chahiye" with no price/timing word.
type InboundFlag = "BOOKING_INTENT" | "INFO_ANSWERED" | "NEEDS_HUMAN";
const STRONG_BOOKING_KEYWORDS = ["book", "call me", "call kar", "slot", "time de", "milna hai", "available ho"];
const INFO_KEYWORDS = ["time", "timing", "address", "location", "kaha", "fee", "fees", "price", "cost", "kitna", "kitni", "kitne", "charges"];
const SOFT_BOOKING_KEYWORDS = ["appointment", "consult"];
function classifyInbound(text: string): { flag: InboundFlag; campaign: string } {
  const t = text.toLowerCase();
  if (STRONG_BOOKING_KEYWORDS.some((k) => t.includes(k))) return { flag: "BOOKING_INTENT", campaign: "LEAD_BOOKING_ACK" };
  if (INFO_KEYWORDS.some((k) => t.includes(k))) return { flag: "INFO_ANSWERED", campaign: "LEAD_INFO_REPLY" };
  if (SOFT_BOOKING_KEYWORDS.some((k) => t.includes(k))) return { flag: "BOOKING_INTENT", campaign: "LEAD_BOOKING_ACK" };
  return { flag: "NEEDS_HUMAN", campaign: "LEAD_GENERIC_ACK" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  // Signature check needs the EXACT raw bytes AiSensy signed -- reading
  // req.text() first and verifying against that string, not a re-
  // serialized JSON.parse() round-trip, which could differ in whitespace/
  // key order and silently fail every single verification.
  const rawBody = await req.text();
  const secret = Deno.env.get("AISENSY_WEBHOOK_SECRET");
  const signature = req.headers.get("x-aisensy-signature") ?? "";
  if (!secret) {
    console.error("AISENSY_WEBHOOK_SECRET not configured -- refusing all callbacks until it is set to match AiSensy's dashboard.");
    return new Response(JSON.stringify({ error: "Webhook not configured" }), { status: 401 });
  }
  const valid = await verifySignature(rawBody, signature, secret);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const payload = JSON.parse(rawBody);
    const statuses: StatusEntry[] = [];
    const messages: MessageEntry[] = [];
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const s of change?.value?.statuses ?? []) statuses.push(s);
        for (const m of change?.value?.messages ?? []) messages.push(m);
      }
    }

    let matched = 0, unmatched = 0;
    for (const s of statuses) {
      if (!s.status) continue;
      const nowIso = new Date().toISOString();

      // Primary match: the wamid captured at send time. Falls back to
      // "most recent sent-but-not-yet-delivered row to this number" when
      // message_id wasn't captured (e.g. AiSensy's send response didn't
      // have the field we guessed, or this predates that capture going
      // live) -- approximate, but far better than no visibility at all.
      let rowId: string | null = null;
      if (s.id) {
        const { data } = await supabaseAdmin.from("whatsapp_log").select("id").eq("message_id", s.id).maybeSingle();
        rowId = data?.id ?? null;
      }
      if (!rowId && s.recipient_id) {
        const last10 = s.recipient_id.replace(/\D/g, "").slice(-10);
        const { data } = await supabaseAdmin
          .from("whatsapp_log")
          .select("id")
          .eq("status", "sent")
          .is("delivered_at", null)
          .ilike("destination", `%${last10}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        rowId = data?.id ?? null;
      }
      if (!rowId) { unmatched++; continue; }

      const update: Record<string, unknown> = {};
      if (s.status === "delivered") {
        update.delivered_at = nowIso;
      } else if (s.status === "read") {
        update.read_at = nowIso;
        update.delivered_at = nowIso; // read implies delivered, even if that event was missed
      } else if (s.status === "failed") {
        update.delivery_failed_at = nowIso;
        update.delivery_failed_reason = s.errors?.[0]?.title || s.errors?.[0]?.message || "Delivery failed";
      } else {
        continue; // "sent" etc. -- nothing new to record, we already logged this at send time
      }
      const { error } = await supabaseAdmin.from("whatsapp_log").update(update).eq("id", rowId);
      if (!error) matched++;
    }

    // ---- Inbound replies (13 Oct 2026, Option B) ----
    let repliesHandled = 0, repliesIgnored = 0;
    const apiKey = Deno.env.get("AISENSY_API_KEY");
    for (const m of messages) {
      if (m.type !== "text" || !m.text?.body || !m.from) { repliesIgnored++; continue; }
      const mobile = m.from.replace(/\D/g, "").slice(-10);
      const bodyText = m.text.body.slice(0, 1000); // generous cap, just in case

      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, name, status, dnd")
        .eq("mobile", mobile)
        .maybeSingle();

      if (!lead) {
        // Not a known lead (could be an existing patient, or a number not
        // in our lead table at all) — log nothing structured, nothing to
        // react to without a lead row to attach it to.
        repliesIgnored++;
        continue;
      }

      const { flag, campaign } = classifyInbound(bodyText);

      // Stop the automated outbound sequence immediately — see
      // lead-touch-sequencer's stop-condition comment. A reply means a
      // real conversation has started; blind automation stands down.
      await supabaseAdmin.from("leads").update({
        last_inbound_at: new Date().toISOString(),
        last_inbound_text: bodyText,
        inbound_flag: flag,
        // HOT (16 Oct 2026, Dr. Yadav) — a lead that actually replies is a
        // real signal regardless of what they said; unconditional, not
        // just for BOOKING_INTENT. Pairs with sync-justdial-leads/
        // justdial-lead-webhook now defaulting new leads to WARM instead
        // of HOT, so "HOT" in Lead CRM means something again.
        lead_quality: "HOT",
      }).eq("id", lead.id);

      await supabaseAdmin.from("interactions").insert({
        lead_id: lead.id,
        type: "whatsapp",
        summary: `Lead replied: "${bodyText.slice(0, 200)}" (classified ${flag})`,
      });

      // Auto-reply — gated exactly like every other campaign; OFF by
      // default (migration 0087) until Dr. Yadav reviews + approves each
      // template and turns it on from Owner > WhatsApp.
      if (apiKey && !lead.dnd) {
        const gate = await checkCampaignGate(supabaseAdmin, campaign);
        if (gate.allowed) {
          try {
            const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                apiKey, campaignName: campaign, destination: mobile,
                userName: lead.name, source: "YHC-OS", templateParams: [lead.name],
              }),
            });
            const data = await res.json().catch(() => ({}));
            await supabaseAdmin.from("whatsapp_log").insert({
              patient_id: null,
              campaign_name: campaign,
              destination: mobile,
              status: res.ok ? "sent" : "failed",
              error_message: res.ok ? null : (data?.message ?? "AiSensy send failed"),
              message_id: res.ok ? extractMessageId(data) : null,
              provider_response: data,
            });
          } catch {
            // Lead/flag already saved — an auto-reply hiccup must not lose the inbound record
          }
        }
      }
      repliesHandled++;
    }

    return new Response(JSON.stringify({ success: true, matched, unmatched, repliesHandled, repliesIgnored }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("aisensy-whatsapp-status processing failed:", e);
    // Still 2xx -- a malformed/unexpected payload shouldn't make AiSensy
    // retry-storm this endpoint; the failure is logged for us to see.
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 200 });
  }
});
