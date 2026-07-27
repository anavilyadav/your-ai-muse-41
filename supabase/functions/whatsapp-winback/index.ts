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

import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async () => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AISENSY_API_KEY not configured as a secret" }), { status: 500 });
    }

    const { data: tiers, error: tiersErr } = await supabaseAdmin
      .from("winback_tiers")
      .select("*")
      .eq("active", true)
      .order("days_lapsed", { ascending: true });
    if (tiersErr) return new Response(JSON.stringify({ error: tiersErr.message }), { status: 400 });

    let sent = 0, skipped = 0, failed = 0;

    for (const tier of tiers ?? []) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - tier.days_lapsed);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

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

      for (const patient of candidates ?? []) {
        // Already sent this exact tier to this patient? Skip.
        const { count } = await supabaseAdmin
          .from("winback_log")
          .select("id", { count: "exact", head: true })
          .eq("patient_id", patient.id)
          .eq("tier_days", tier.days_lapsed);
        if ((count ?? 0) > 0) { skipped++; continue; }

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
            sent++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
