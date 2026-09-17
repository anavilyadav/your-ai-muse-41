// Receives WhatsApp delivery/read status callbacks from AiSensy (17 Sep
// 2026 -- Dr. Yadav wants to see per-patient whether messages are
// actually failing to deliver, not just whether the send API accepted
// them).
//
// AiSensy passes through Meta's own WhatsApp Cloud API webhook shape
// unmodified: entry[].changes[].value.statuses[], each with
// { id: "wamid...", status: "delivered"|"read"|"failed"|..., recipient_id,
// errors? }. Confirmed against AiSensy's own docs (aisensy.stoplight.io);
// the outbound message id this needs to match against is captured
// best-effort at send time in each sending function -- see the
// extractMessageId() comment duplicated in each of those files for why
// that field isn't 100% confirmed from AiSensy's send-response docs, and
// the destination+recency fallback below for when it doesn't match.
//
// SETUP NEEDED IN AISENSY'S OWN DASHBOARD (cannot be done from here):
//   1. Project settings -> Webhooks -> add this function's URL.
//   2. Set a webhook shared secret there, and set the SAME value as this
//      project's AISENSY_WEBHOOK_SECRET edge function secret.
// Without both sides matching, every callback gets rejected with 401.
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
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const s of change?.value?.statuses ?? []) statuses.push(s);
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

    return new Response(JSON.stringify({ success: true, matched, unmatched }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("aisensy-whatsapp-status processing failed:", e);
    // Still 2xx -- a malformed/unexpected payload shouldn't make AiSensy
    // retry-storm this endpoint; the failure is logged for us to see.
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 200 });
  }
});
