// Runs every 30 min (cron, migration 0086). Sends the no-reply follow-ups
// of the lead WhatsApp flow through lead-flow-send:
//   LEAD_NUDGE_1 — din 2, LEAD_NUDGE_2 — din 5, LEAD_NUDGE_3 — din 10 (last)
// counted from when the welcome actually went out (leads.wa_welcome_sent_at).
// Leads whose welcome never went out — including all 31k imported before
// the flow existed — are never touched, so turning WhatsApp on can't blast
// old leads (19 Oct 2026). Three, not five: every unanswered message risks
// a block, and blocks lower the WhatsApp number's quality rating.
//
// Stops for good when: dnd, CONVERTED/LOST, a staff call is logged
// (call_count > 0), or the lead replied (last_inbound_at).
// auto_touch_count: 1 = welcome done, 2..4 = nudge 1..3 done.

import { createClient } from "npm:@supabase/supabase-js@2";

function requireCronSecret(req: Request): Response | null {
  const expected = Deno.env.get("CRON_FUNCTION_SECRET");
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected) {
    return new Response(JSON.stringify({ error: "Unauthorized: CRON_FUNCTION_SECRET not configured" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const okLen = got.length === expected.length;
  let diff = okLen ? 0 : 1;
  if (okLen) for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  return null;
}

const NUDGES: Record<number, { template: string; afterDays: number }> = {
  1: { template: "LEAD_NUDGE_1", afterDays: 2 },
  2: { template: "LEAD_NUDGE_2", afterDays: 5 },
  3: { template: "LEAD_NUDGE_3", afterDays: 10 },
};

const MAX_CANDIDATES = 500; // query-side cap, same spirit as this project's other cron functions

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: candidates, error } = await supabaseAdmin
      .from("leads")
      .select("id, auto_touch_count, wa_welcome_sent_at")
      .not("wa_welcome_sent_at", "is", null)
      .eq("is_deleted", false)
      .eq("dnd", false)
      .eq("call_count", 0)
      .is("last_inbound_at", null)
      .not("status", "in", "(CONVERTED,LOST)")
      .gte("auto_touch_count", 1)
      .lte("auto_touch_count", 3)
      .order("wa_welcome_sent_at", { ascending: true })
      .limit(MAX_CANDIDATES);
    if (error) throw error;

    const now = Date.now();
    const due = new Map<string, string[]>();
    for (const lead of candidates ?? []) {
      const step = NUDGES[lead.auto_touch_count as 1 | 2 | 3];
      if (!step) continue;
      if (now < new Date(lead.wa_welcome_sent_at).getTime() + step.afterDays * 86_400_000) continue;
      due.set(step.template, [...(due.get(step.template) ?? []), lead.id]);
    }

    const secret = Deno.env.get("CRON_FUNCTION_SECRET")!;
    const summary: Record<string, Record<string, number>> = {};
    for (const [template, ids] of due) {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lead-flow-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": secret },
        body: JSON.stringify({ leadIds: ids, template }),
      });
      const out = await res.json().catch(() => ({ results: [] }));
      const counts: Record<string, number> = {};
      for (const r of out.results ?? []) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        // Gated (switch OFF) or a missing photo/PDF = try again next run.
        // Sent or a real send failure = move on, so a bad number doesn't
        // get retried every 30 minutes forever.
        const missingAsset = typeof r.reason === "string" && r.reason.startsWith("missing");
        if (r.status === "sent" || (r.status === "failed" && !missingAsset)) {
          const lead = (candidates ?? []).find((c) => c.id === r.leadId);
          if (lead) await supabaseAdmin.from("leads").update({ auto_touch_count: lead.auto_touch_count + 1 }).eq("id", lead.id);
        }
      }
      summary[template] = counts;
    }

    return new Response(JSON.stringify({ success: true, candidates: (candidates ?? []).length, summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), success: false }), { status: 200 });
  }
});
