// Called by a Google Apps Script trigger bound to the Google Sheet that
// Pabbly already writes JustDial leads into. The trigger fires the
// instant Pabbly appends a row — no polling, no delay — POSTs that row
// here, and this creates the lead + sends an immediate WhatsApp welcome.
//
// Pabbly/the Sheet itself is untouched — this only adds a listener.
//
// Needs:
//   - AISENSY_API_KEY secret (already set for the other WhatsApp functions)
//   - JUSTDIAL_WEBHOOK_SECRET secret (used as the HMAC key now, see below)
//   - An approved AiSensy API Campaign named exactly "LEAD_WELCOME"
//
// AUTH (audit P1-11, Dr. Yadav's decision 29 Jul: rate-limit AND HMAC).
// Preferred: Apps Script sends an `x-justdial-signature` header —
// HMAC-SHA256(JUSTDIAL_WEBHOOK_SECRET, raw request body), hex-encoded.
// The secret itself is never transmitted, so a network/log leak can't be
// replayed the way a plain shared secret could.
// Fallback (TEMPORARY): if no signature header is present, still accepts
// the old `body.secret` plain-secret method, so leads don't stop flowing
// the moment this function is redeployed but before the Apps Script is
// updated to send the signature. Once the Apps Script change is live and
// confirmed (leads still coming in for a day or so), ask me to remove
// this fallback — until then the old leak risk technically still exists
// via this path, rate-limited but not eliminated.
//
// RATE LIMITING: even a correctly-authenticated caller is capped at
// MAX_PER_MINUTE so a compromised secret can't spam unlimited fake leads.
//
// Called with: raw JSON body { name, mobile, note?, secret? }
// Header (preferred): x-justdial-signature: <hex HMAC-SHA256 of the body>

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_PER_MINUTE = 20;

// Plain === on secrets leaks timing information (an attacker can narrow
// down the correct value character-by-character from response latency).
// This always compares every byte regardless of where the mismatch is.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  try {
    const rawBody = await req.text();
    const expectedSecret = Deno.env.get("JUSTDIAL_WEBHOOK_SECRET") ?? "";
    const signatureHeader = req.headers.get("x-justdial-signature");

    let authorized = false;
    if (signatureHeader && expectedSecret) {
      const computed = await hmacHex(expectedSecret, rawBody);
      authorized = constantTimeEqual(computed.toLowerCase(), signatureHeader.trim().toLowerCase());
    } else {
      // Legacy fallback — see migration note above.
      let legacySecret = "";
      try {
        legacySecret = String(JSON.parse(rawBody)?.secret ?? "");
      } catch {
        // not valid JSON — falls through to authorized=false below
      }
      authorized = !!expectedSecret && constantTimeEqual(legacySecret, expectedSecret);
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = JSON.parse(rawBody);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Rate limit (checked right after auth, before doing any real
    // work) — even a correctly-authenticated caller is capped. ----
    await supabaseAdmin.from("webhook_hits").insert({ source: "justdial" });
    // Opportunistic cleanup piggybacked on every hit — keeps the table
    // small without needing a separate cron job.
    await supabaseAdmin.from("webhook_hits").delete().eq("source", "justdial").lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    const { count: recentHits } = await supabaseAdmin
      .from("webhook_hits")
      .select("id", { count: "exact", head: true })
      .eq("source", "justdial")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if ((recentHits ?? 0) > MAX_PER_MINUTE) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded — try again in a minute" }), { status: 429 });
    }

    const name = String(body.name ?? "").trim();
    const mobileRaw = String(body.mobile ?? "").replace(/\D/g, "");
    const mobile = mobileRaw.length > 10 ? mobileRaw.slice(-10) : mobileRaw;
    if (!name || mobile.length !== 10) {
      return new Response(JSON.stringify({ error: "name and 10-digit mobile required" }), { status: 400 });
    }

    // Master on/off — Owner Control Centre → JustDial toggle
    const { data: toggleRow } = await supabaseAdmin.from("settings").select("value").eq("key", "justdial_webhook_enabled").maybeSingle();
    const enabled = toggleRow ? toggleRow.value === "true" : true;
    if (!enabled) {
      return new Response(JSON.stringify({ success: true, skipped: "webhook disabled by owner" }), { status: 200 });
    }

    // Already a patient? Don't create a duplicate lead — just log the
    // enquiry against their existing record instead.
    const { data: existingPatient } = await supabaseAdmin
      .from("patients")
      .select("id")
      .eq("mobile", mobile)
      .eq("mobile_country_code", "+91")
      .maybeSingle();
    if (existingPatient) {
      await supabaseAdmin.from("interactions").insert({
        patient_id: existingPatient.id,
        type: "whatsapp",
        summary: "New JustDial enquiry from existing patient — no duplicate lead created",
      });
      return new Response(JSON.stringify({ success: true, skipped: "already a patient" }), { status: 200 });
    }

    // Already a lead on this number? Don't spam a second welcome message.
    const { data: existingLead } = await supabaseAdmin.from("leads").select("id, dnd").eq("mobile", mobile).maybeSingle();
    let leadId = existingLead?.id;
    if (!leadId) {
      const { data: newLead, error: leadErr } = await supabaseAdmin
        .from("leads")
        .insert({ name, mobile, source: "JustDial", status: "HOT", note: body.note ?? null })
        .select("id")
        .maybeSingle();
      if (leadErr || !newLead) {
        return new Response(JSON.stringify({ error: leadErr?.message ?? "Failed to create lead" }), { status: 500 });
      }
      leadId = newLead.id;
    } else if (existingLead?.dnd) {
      return new Response(JSON.stringify({ success: true, leadId, skipped: "lead has DND set" }), { status: 200 });
    } else {
      return new Response(JSON.stringify({ success: true, leadId, skipped: "lead already existed, no repeat welcome" }), { status: 200 });
    }

    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (apiKey) {
      try {
        const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            campaignName: "LEAD_WELCOME",
            destination: mobile,
            userName: name,
            source: "YHC-OS",
            templateParams: [name],
          }),
        });
        if (res.ok) {
          await supabaseAdmin.from("interactions").insert({
            lead_id: leadId,
            type: "whatsapp",
            summary: "LEAD_WELCOME sent (JustDial auto)",
          });
        }
      } catch {
        // Lead is already saved — a WhatsApp hiccup must not fail the whole request
      }
    }

    return new Response(JSON.stringify({ success: true, leadId }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
