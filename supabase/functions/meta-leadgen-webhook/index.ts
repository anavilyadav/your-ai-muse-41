// Meta (Facebook/Instagram) Lead Ads — "Instant Form" auto-capture.
//
// DESIGN GOAL (Dr. Yadav, 06 Aug 2026): once this is connected to the
// clinic's Page ONE TIME (see the setup checklist Claude gave alongside
// this file), it needs ZERO further backend touch. Meta subscribes at the
// PAGE level, not per-ad or per-form — every future ad campaign, every new
// Instant Form created under that Page (whether the ad itself runs on
// Facebook or Instagram), flows through this same webhook automatically.
// Launching a new ad next month needs nothing here, ever.
//
// HOW META LEAD ADS WORK (background, since this protocol is unlike the
// other webhooks in this project):
//   1. Someone taps a Lead Ad on FB/Insta, fills Meta's own native form —
//      never touches our site at all.
//   2. Meta POSTs a lightweight notification here: just IDs (leadgen_id,
//      page_id, form_id), not the actual name/phone.
//   3. This function calls Meta's Graph API with the Page Access Token to
//      fetch the real field_data for that leadgen_id, THEN creates the lead.
//   4. Meta requires a GET "verification handshake" once, when the webhook
//      is first subscribed in Meta's dashboard — handled below.
//
// SECRETS NEEDED (one-time Dashboard setup, same as AISENSY_API_KEY):
//   META_VERIFY_TOKEN     — any string you choose, entered in BOTH this
//                           Dashboard secret AND Meta's webhook setup form.
//   META_APP_SECRET       — from Meta App Dashboard → Settings → Basic.
//                           Used to verify each POST is really from Meta.
//   META_PAGE_ACCESS_TOKEN — a long-lived Page token from Meta's Graph API
//                           Explorer, needs leads_retrieval + pages_manage_ads.
//
// Lead source is set to FACEBOOK by default (Meta's leadgen payload doesn't
// cleanly say FB vs IG placement without extra API calls) — `source_ref`
// stores the form_id so Owner can still tell campaigns apart in reports.

import { createClient } from "npm:@supabase/supabase-js@2";

async function verifySignature(appSecret: string, rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.toLowerCase().charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---- 1. Meta's one-time verification handshake (GET) ----
  // Fires only when you click "Verify and Save" in Meta's webhook setup
  // screen — never during normal operation afterwards.
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("META_VERIFY_TOKEN") ?? "";
    if (mode === "subscribe" && expected && token === expected) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response(JSON.stringify({ error: "Verification failed" }), { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "GET (verification) or POST only" }), { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
    const signature = req.headers.get("x-hub-signature-256");
    if (!appSecret) {
      return new Response(JSON.stringify({ error: "Webhook not configured — META_APP_SECRET missing" }), { status: 401 });
    }
    if (!(await verifySignature(appSecret, rawBody, signature))) {
      return new Response(JSON.stringify({ error: "Unauthorized — signature mismatch" }), { status: 401 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Master on/off — Owner Control Centre → Lead Sources → toggle.
    const { data: toggleRow } = await supabaseAdmin.from("settings").select("value").eq("key", "meta_leadgen_enabled").maybeSingle();
    const enabled = toggleRow ? toggleRow.value === "true" : true;
    if (!enabled) {
      return new Response(JSON.stringify({ success: true, skipped: "webhook disabled by owner" }), { status: 200 });
    }

    const pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN");
    const body = JSON.parse(rawBody);
    const results: any[] = [];

    // Meta batches multiple lead events into one POST — entry[].changes[]
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "leadgen") continue;
        const leadgenId = change.value?.leadgen_id;
        const formId = change.value?.form_id;
        if (!leadgenId || !pageAccessToken) continue;

        // Meta's notification is just IDs — fetch the actual answers.
        const graphRes = await fetch(
          `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${pageAccessToken}`,
        );
        if (!graphRes.ok) {
          results.push({ leadgenId, error: `Graph API ${graphRes.status}` });
          continue;
        }
        const leadData = await graphRes.json();
        const fields: { name: string; values: string[] }[] = leadData.field_data ?? [];
        const get = (key: string) => fields.find((f) => f.name.toLowerCase() === key)?.values?.[0] ?? "";

        const name = get("full_name") || `${get("first_name")} ${get("last_name")}`.trim();
        const mobileRaw = (get("phone_number") || "").replace(/\D/g, "");
        const mobile = mobileRaw.length > 10 ? mobileRaw.slice(-10) : mobileRaw;
        if (!name || mobile.length !== 10) {
          results.push({ leadgenId, skipped: "missing name/valid phone in Meta's form data" });
          continue;
        }

        const { data: existingPatient } = await supabaseAdmin
          .from("patients").select("id").eq("mobile", mobile).eq("mobile_country_code", "+91").maybeSingle();
        if (existingPatient) {
          await supabaseAdmin.from("interactions").insert({
            patient_id: existingPatient.id, type: "whatsapp",
            summary: "New Meta Lead Ad enquiry from existing patient — no duplicate lead created",
          });
          results.push({ leadgenId, skipped: "already a patient" });
          continue;
        }

        const { data: existingLead } = await supabaseAdmin.from("leads").select("id, dnd").eq("mobile", mobile).maybeSingle();
        if (existingLead) {
          results.push({ leadgenId, leadId: existingLead.id, skipped: "lead already existed" });
          continue;
        }

        const { data: newLead, error: leadErr } = await supabaseAdmin
          .from("leads")
          .insert({
            name, mobile,
            lead_source: "FACEBOOK", // see file header — FB/IG can't be cleanly split without extra Graph calls
            status: "NEW",
            lead_quality: "HOT", // someone who filled a paid ad form has real intent
            source_ref: formId ? `meta_form:${formId}` : null,
          })
          .select("id").maybeSingle();
        if (leadErr || !newLead) {
          results.push({ leadgenId, error: leadErr?.message ?? "insert failed" });
          continue;
        }

        const apiKey = Deno.env.get("AISENSY_API_KEY");
        if (apiKey) {
          try {
            const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                apiKey, campaignName: "LEAD_WELCOME", destination: mobile,
                userName: name, source: "YHC-OS", templateParams: [name],
              }),
            });
            if (res.ok) {
              await supabaseAdmin.from("interactions").insert({
                lead_id: newLead.id, type: "whatsapp", summary: "LEAD_WELCOME sent (Meta Lead Ad auto)",
              });
            }
          } catch {
            // lead already saved — WhatsApp hiccup must not fail the request
          }
        }
        results.push({ leadgenId, leadId: newLead.id, created: true });
      }
    }

    // Meta expects a fast 200 regardless of per-lead outcome, or it retries
    // the whole batch — per-item errors are in the body for our own logs.
    return new Response(JSON.stringify({ success: true, results }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
