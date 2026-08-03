// Runs on a schedule (Supabase Cron — 6:00 AM IST daily, see migration
// 0021's companion cron.schedule below / the SQL file shipped alongside
// this function).
//
// Phase 3 decision #28 (29 Jul 2026): "Confirmed — banega. Har raat
// automatic check, subah Owner ko alert agar kuch gadbad mile."
//
// Calls the run_nightly_data_health() Postgres function (migration 0021)
// -- that's where the actual checks live, since several of them (reading
// cron.job, cross-table counts) are naturally SQL. This function's only
// job: call it, and if anything needs attention, write ONE system_alerts
// row (not one per failed check -- avoids alert-fatigue on a bad night)
// so it shows up on the existing Owner > System Health page, which
// already renders unresolved system_alerts rows at the top.

import { createClient } from "npm:@supabase/supabase-js@2";

const CHECK_LABELS: Record<string, string> = {
  stale_open_visits: "Visits jo 30+ din se open pade hain",
  whatsapp_failures_24h: "WhatsApp fail rate pichhle 24 ghante mein",
  cron_jobs: "Automatic (cron) jobs missing/inactive",
  duplicate_settings_keys: "Settings mein duplicate keys (race condition)",
  orphan_visits: "Visits jinka patient record hi nahi mila",
};

Deno.serve(async () => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabaseAdmin.rpc("run_nightly_data_health");
    if (error) {
      // The check itself failing to run is worth an alert too -- silence
      // here would be worse than a false alarm.
      await supabaseAdmin.from("system_alerts").insert({
        type: "NIGHTLY_HEALTH",
        message: `Nightly health check khud fail ho gaya: ${error.message}`,
        context: { error: error.message },
      });
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }

    const result = data as { has_issue: boolean; checks: { check: string; status: string; value: unknown }[]; run_at: string };
    if (!result.has_issue) {
      return new Response(JSON.stringify({ success: true, has_issue: false }), { headers: { "Content-Type": "application/json" } });
    }

    const problems = result.checks.filter((c) => c.status !== "PASS");
    const summary = problems
      .map((c) => `${CHECK_LABELS[c.check] ?? c.check} (${c.status}): ${JSON.stringify(c.value)}`)
      .join(" • ");

    await supabaseAdmin.from("system_alerts").insert({
      type: "NIGHTLY_HEALTH",
      message: `Raat ke health check mein ${problems.length} cheez(en) mili jo dekhni hain — ${summary}`,
      context: { checks: result.checks, run_at: result.run_at },
    });

    return new Response(JSON.stringify({ success: true, has_issue: true, problems: problems.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
