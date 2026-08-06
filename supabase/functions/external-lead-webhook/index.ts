// ONE generic, reusable webhook for any external form: website enquiry
// form, a Google Form (via an Apps Script trigger, same pattern as
// justdial-lead-webhook), Zapier/Make/Pabbly connecting some other tool.
//
// DESIGN GOAL (Dr. Yadav, 06 Aug 2026): "backend pe kuch na touch karna
// pade" — after this is deployed ONCE, connecting a brand-new website
// form, a new landing page, or a new no-code automation needs ZERO code
// changes and ZERO redeploys. Point the new tool at this same URL with the
// same secret, tell it which `source` it is, done. New forms are a config
// change on the OTHER platform, not here.
//
// AUTH: static shared secret (x-lead-secret header OR "secret" in the JSON
// body — different form/webhook tools support different things, so both
// are accepted). Deliberately NOT HMAC like justdial-lead-webhook: most
// website form builders, Google Forms Apps Script triggers, and no-code
// tools (Zapier/Make/Pabbly) can set a static header or a body field, but
// can't easily compute an HMAC signature. Same threat model as
// backup-to-sheets' shared-secret pattern.
//
// Secret lives in Edge Function secrets (EXTERNAL_LEAD_WEBHOOK_SECRET) —
// a ONE-TIME Dashboard step, same as AISENSY_API_KEY was. It is NOT in the
// `settings` table on purpose: RLS is off project-wide right now (audit
// finding C-1, already on the roadmap), so anything in `settings` is
// readable via the public anon key today. A webhook secret sitting there
// would defeat its own purpose until RLS lands. Once RLS is on, this can
// move to Owner-rotatable Settings if wanted.
//
// Called with: raw JSON body
//   { source, name, mobile, secret?, note?, disease_interest?, source_ref? }
// Header (alternative to body.secret): x-lead-secret: <the secret>
// `source` must be one of leads_lead_source_check's values (WALK_IN,
// JUSTDIAL, WHATSAPP, INSTAGRAM, FACEBOOK, GOOGLE, REFERRAL, YOUTUBE,
// OTHER) — invalid values are rejected with a clear error rather than
// silently bucketed under OTHER, so a typo'd source is caught immediately
// by whoever is setting up the new integration, not discovered later in
// broken reporting.

import { createClient } from "npm:@supabase/supabase-js@2";
import { constantTimeEqual } from "../_shared/cron-auth.ts";

const MAX_PER_MINUTE = 30; // higher than JustDial's 20 — this serves multiple sources at once
const VALID_SOURCES = ["WALK_IN", "JUSTDIAL", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "GOOGLE", "REFERRAL", "YOUTUBE", "OTHER"];

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  try {
    const body = await req.json();
    const expectedSecret = Deno.env.get("EXTERNAL_LEAD_WEBHOOK_SECRET") ?? "";
    const gotSecret = req.headers.get("x-lead-secret") ?? String(body.secret ?? "");

    if (!expectedSecret) {
      // Fail-closed, matching the rest of the project's convention — an
      // unset secret must never mean "let everyone in".
      return new Response(JSON.stringify({ error: "Webhook not configured — EXTERNAL_LEAD_WEBHOOK_SECRET missing" }), { status: 401 });
    }
    if (!constantTimeEqual(gotSecret, expectedSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate limit — shared webhook_hits table, its own bucket so it can't
    // starve JustDial's allowance or vice versa.
    await supabaseAdmin.from("webhook_hits").insert({ source: "external" });
    await supabaseAdmin.from("webhook_hits").delete().eq("source", "external").lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    const { count: recentHits } = await supabaseAdmin
      .from("webhook_hits")
      .select("id", { count: "exact", head: true })
      .eq("source", "external")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if ((recentHits ?? 0) > MAX_PER_MINUTE) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded — try again in a minute" }), { status: 429 });
    }

    // Master on/off — Owner Control Centre → Lead Sources → toggle.
    const { data: toggleRow } = await supabaseAdmin.from("settings").select("value").eq("key", "external_lead_webhook_enabled").maybeSingle();
    const enabled = toggleRow ? toggleRow.value === "true" : true;
    if (!enabled) {
      return new Response(JSON.stringify({ success: true, skipped: "webhook disabled by owner" }), { status: 200 });
    }

    const name = String(body.name ?? "").trim();
    const mobileRaw = String(body.mobile ?? "").replace(/\D/g, "");
    const mobile = mobileRaw.length > 10 ? mobileRaw.slice(-10) : mobileRaw;
    const source = String(body.source ?? "").trim().toUpperCase();
    if (!name || mobile.length !== 10) {
      return new Response(JSON.stringify({ error: "name and 10-digit mobile required" }), { status: 400 });
    }
    if (!VALID_SOURCES.includes(source)) {
      return new Response(JSON.stringify({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` }), { status: 400 });
    }

    // Already a patient? Log the enquiry against their existing record,
    // don't create a duplicate lead.
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
        summary: `New ${source} enquiry from existing patient — no duplicate lead created`,
      });
      return new Response(JSON.stringify({ success: true, skipped: "already a patient" }), { status: 200 });
    }

    // Already a lead on this number? Don't spam a second welcome message.
    const { data: existingLead } = await supabaseAdmin.from("leads").select("id, dnd").eq("mobile", mobile).maybeSingle();
    let leadId = existingLead?.id;
    if (!leadId) {
      const { data: newLead, error: leadErr } = await supabaseAdmin
        .from("leads")
        .insert({
          name,
          mobile,
          lead_source: source,
          status: "NEW",
          lead_quality: "WARM", // conservative default — Owner can bump to HOT from the Manage panel
          notes: body.note ?? null,
          disease_interest: body.disease_interest ?? null,
          source_ref: body.source_ref ?? null,
        })
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
            summary: `LEAD_WELCOME sent (${source} auto)`,
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
