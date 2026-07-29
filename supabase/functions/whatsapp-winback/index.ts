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

// Edge Functions run in UTC. India has no DST, so IST is always exactly
// UTC+5:30 -- shift the clock by that fixed offset before reading date
// parts, instead of trusting the server's own local calendar date. Without
// this, a cron that fires in the IST 12:00am-5:29am window reads a date
// that's still "yesterday" in UTC, and every day-based comparison
// (cutoffStr here) is off by one for that window.
function istDateNDaysAgoStr(daysAgo: number): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  istNow.setUTCDate(istNow.getUTCDate() - daysAgo);
  return istNow.toISOString().slice(0, 10);
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
      const cutoffStr = istDateNDaysAgoStr(tier.days_lapsed);

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
      if (!candidates || candidates.length === 0) continue;

      // Was one dedup query PER candidate (N+1 — e.g. 500 patients in a
      // tier meant 500 round trips just to check "already sent?"). Now one
      // query for the whole tier: fetch every patient_id already sent this
      // tier, from just the candidate set, and check membership in memory.
      const candidateIds = candidates.map((p: any) => p.id);
      const { data: alreadySent } = await supabaseAdmin
        .from("winback_log")
        .select("patient_id")
        .eq("tier_days", tier.days_lapsed)
        .in("patient_id", candidateIds);
      const alreadySentSet = new Set((alreadySent ?? []).map((r: any) => r.patient_id));

      for (const patient of candidates) {
        if (alreadySentSet.has(patient.id)) { skipped++; continue; }

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
