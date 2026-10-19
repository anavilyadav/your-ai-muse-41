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
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

// Lead flow routing (19 Oct 2026). Every tap on a template button arrives
// as its button text; each text maps to what to send next and which
// "pain profile" answer it is. Texts must match the approved AiSensy
// templates exactly (see the WhatsApp lead flow page). Rule-based on
// purpose: every reply is pre-written and reviewed, nothing improvised
// (NCH advertising rules).
type InboundFlag = "BOOKING_INTENT" | "INFO_ANSWERED" | "NEEDS_HUMAN";
type Route = { next: string | null; field?: "symptom" | "duration" | "treatment" | "consult"; flag?: InboundFlag; stop?: boolean };

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const ROUTES = new Map<string, Route>();
const add = (texts: string[], route: Route) => texts.forEach((t) => ROUTES.set(norm(t), route));

// Welcome answers (symptom per category) -> how long?
add([
  "Sar dard / Migraine", "Chakkar aana", "Nas ka dard", "Khujli / Eczema", "Psoriasis / Daag", "Baal jhadna",
  "Baar-baar sardi", "Pet / Bhookh kam", "Gas / Acidity", "Kabz / IBS", "Piles / Fissure", "Asthma / Saans",
  "Allergy / Cheenk", "Purani khansi", "Skin / Baal", "Bachche ke liye", "Peshaab ki takleef", "Pathri / Stone",
  "Prostate", "Kidney stone", "Report gadbad hai", "Ghutno ka dard", "Kamar / Gardan", "Arthritis / Sujan",
  "Side effects", "Kamzori / Thakaan", "Bolna / Speech", "Dhyan / Behaviour", "Neend / Gussa",
  "Rheumatoid arthritis", "Lupus / SLE", "PCOD / PCOS", "Periods ki problem", "Thyroid", "Wazan / Sugar",
  "Neend nahi aati", "Ghabrahat / Tension", "High BP", "Cholesterol", "Kuch aur",
], { next: "LEAD_STEP_DURATION", field: "symptom" });
add(["Pehle chat par", "Apni problem batani"], { next: "LEAD_STEP_DURATION" });
add(["6 mahine se kam", "6 mahine – 2 saal", "6 mahine - 2 saal", "2 saal se zyada"], { next: "LEAD_STEP_TREATMENT", field: "duration" });
add(["Dawai chal rahi hai", "Li thi, fayda nahi", "Abhi kuch nahi"], { next: "LEAD_STEP_CONSULT", field: "treatment" });
add(["Pehle jaankari"], { next: "LEAD_STEP_CONSULT" });
add(["Clinic aakar", "Appointment chahiye"], { next: "LEAD_REPLY_CLINIC", field: "consult", flag: "BOOKING_INTENT" });
add(["Video consultation"], { next: "LEAD_REPLY_VIDEO", field: "consult", flag: "BOOKING_INTENT" });
add(["Pehle call karein", "Doctor se baat", "Private call", "Haan, call karein", "Abhi baat karni hai", "Time fix karein"],
  { next: "LEAD_REPLY_CALL", field: "consult", flag: "BOOKING_INTENT" });
add(["Fees / timing", "Fees jaanni hai"], { next: "LEAD_REPLY_FEES", flag: "INFO_ANSWERED" });
add(["Dawai kaise milegi"], { next: "LEAD_REPLY_DELIVERY", flag: "INFO_ANSWERED" });
add(["Message band karein", "STOP", "Stop karo", "Band karo"], { next: "LEAD_REPLY_STOP", stop: true });
add(["Abhi nahi"], { next: null });

// Typed messages: price/timing -> fees reply, medicine/delivery -> delivery
// reply, "call/book" -> call reply, anything else -> "team will reply" and
// a human picks it up from Lead CRM.
const FEES_WORDS = ["fee", "fees", "price", "cost", "kitna", "kitni", "kitne", "charges", "timing", "address", "location", "kaha"];
const DELIVERY_WORDS = ["dawai", "dawa", "medicine", "delivery", "courier", "porter", "swiggy", "ghar par", "bhej"];
const CALL_WORDS = ["book", "call", "appointment", "slot", "milna", "consult", "available"];
function routeTyped(text: string): Route {
  const t = norm(text);
  if (/^(stop|unsubscribe|band karo|message band)/.test(t)) return { next: "LEAD_REPLY_STOP", stop: true };
  if (FEES_WORDS.some((w) => t.includes(w))) return { next: "LEAD_REPLY_FEES", flag: "INFO_ANSWERED" };
  if (DELIVERY_WORDS.some((w) => t.includes(w))) return { next: "LEAD_REPLY_DELIVERY", flag: "INFO_ANSWERED" };
  if (CALL_WORDS.some((w) => t.includes(w))) return { next: "LEAD_REPLY_CALL", flag: "BOOKING_INTENT" };
  return { next: "LEAD_REPLY_TYPED", flag: "NEEDS_HUMAN" };
}

async function callLeadFlowSend(leadId: string, template: string, allowDnd = false) {
  const secret = Deno.env.get("CRON_FUNCTION_SECRET");
  if (!secret) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lead-flow-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ leadIds: [leadId], template, allowDnd }),
    });
  } catch {
    // The tap is already saved on the lead; staff can follow up by hand.
  }
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

    // ---- Inbound replies: lead flow ----
    // A tap on a template button arrives as type "button" (or
    // "interactive"); a typed reply as "text". Either way the lead goes
    // HOT, the automatic follow-ups stop (last_inbound_at), the answer is
    // saved on the lead, and lead-flow-send sends the next message.
    let repliesHandled = 0, repliesIgnored = 0;
    for (const m of messages) {
      const tapped = m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
      const typed = m.type === "text" ? m.text?.body ?? null : null;
      const replyText = (tapped ?? typed ?? "").slice(0, 1000);
      if (!replyText || !m.from) { repliesIgnored++; continue; }
      const mobile = m.from.replace(/\D/g, "").slice(-10);

      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, pain_profile")
        .eq("mobile", mobile)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lead) { repliesIgnored++; continue; }

      const route = (tapped ? ROUTES.get(norm(tapped)) : undefined) ?? routeTyped(replyText);
      const nowIso = new Date().toISOString();
      const profile: Record<string, unknown> = { ...(lead.pain_profile ?? {}) };
      if (route.field) profile[route.field] = replyText;
      if (!tapped) profile.typed = replyText;
      profile.history = [...((profile.history as unknown[]) ?? []), { at: nowIso, text: replyText, tapped: !!tapped }].slice(-30);
      profile.updatedAt = nowIso;

      const update: Record<string, unknown> = {
        last_inbound_at: nowIso,
        last_inbound_text: replyText,
        lead_quality: "HOT",
        pain_profile: profile,
      };
      if (route.flag) update.inbound_flag = route.flag;
      await supabaseAdmin.from("leads").update(update).eq("id", lead.id);
      await supabaseAdmin.from("interactions").insert({
        lead_id: lead.id, type: "whatsapp",
        summary: `${tapped ? "Button dabaya" : "Patient ne likha"}: "${replyText.slice(0, 200)}"`,
      });

      if (route.next) await callLeadFlowSend(lead.id, route.next, route.stop === true);
      if (route.stop) await supabaseAdmin.from("leads").update({ dnd: true }).eq("id", lead.id);
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
