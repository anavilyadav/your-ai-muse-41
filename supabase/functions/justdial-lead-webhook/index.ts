// Called by a Google Apps Script trigger bound to the Google Sheet that
// Pabbly already writes JustDial leads into. The trigger fires the
// instant Pabbly appends a row — no polling, no delay — POSTs that row
// here, and this creates the lead + sends an immediate WhatsApp welcome.
//
// Pabbly/the Sheet itself is untouched — this only adds a listener.
//
// Needs:
//   - AISENSY_API_KEY secret (already set for the other WhatsApp functions)
//   - JUSTDIAL_WEBHOOK_SECRET secret (shared secret so randoms on the
//     internet can't POST fake leads — the Apps Script sends it back)
//   - An approved AiSensy API Campaign named exactly "LEAD_WELCOME"
//
// Called with: { name, mobile, note?, secret }

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  try {
    const body = await req.json();
    const expectedSecret = Deno.env.get("JUSTDIAL_WEBHOOK_SECRET");
    if (!expectedSecret || body.secret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const name = String(body.name ?? "").trim();
    const mobileRaw = String(body.mobile ?? "").replace(/\D/g, "");
    const mobile = mobileRaw.length > 10 ? mobileRaw.slice(-10) : mobileRaw;
    if (!name || mobile.length !== 10) {
      return new Response(JSON.stringify({ error: "name and 10-digit mobile required" }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
