// Runs on a schedule (via Supabase Cron / pg_cron — set up in the
// Dashboard, no app code needed for the schedule itself).
//
// Finds all followups due today (or overdue) that haven't had a reminder
// sent yet, and sends each patient a WhatsApp FOLLOWUP_REMINDER via AiSensy,
// then marks them as sent so they're never messaged twice.
//
// Needs an approved AiSensy API Campaign named exactly "FOLLOWUP_REMINDER".

import { createClient } from "npm:@supabase/supabase-js@2";

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

    const today = new Date().toISOString().slice(0, 10);
    const { data: due, error } = await supabaseAdmin
      .from("followups")
      .select("id, patient_id, due_date, followup_type, patients(name, mobile, wa_consent)")
      .eq("status", "PENDING")
      .lte("due_date", today)
      .is("reminder_sent_at", null);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    let sent = 0, skipped = 0, failed = 0;
    for (const f of due ?? []) {
      const patient = (f as any).patients;
      if (!patient?.mobile || !patient?.wa_consent) { skipped++; continue; }
      try {
        const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            campaignName: "FOLLOWUP_REMINDER",
            destination: patient.mobile,
            userName: patient.name,
            source: "YHC-OS",
            templateParams: [patient.name],
          }),
        });
        if (res.ok) {
          await supabaseAdmin.from("followups").update({ reminder_sent_at: new Date().toISOString() }).eq("id", f.id);
          sent++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
