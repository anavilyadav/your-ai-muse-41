// Daily safety-net backup — copies key tables into a Google Sheet, so if
// Supabase/the app ever gets stuck, patient/business data is still readable
// and recoverable from Sheets (which the whole clinic already knows how to
// use, from the original YHC-OS days).
//
// Requires two secrets:
//   BACKUP_SHEETS_URL     — the Google Apps Script Web App URL
//   BACKUP_FUNCTION_SECRET — shared secret the Cron job must send back in
//                            the x-backup-secret header. Without this, any
//                            random request to this URL would dump every
//                            patient's PII + every payment record.

import { createClient } from "npm:@supabase/supabase-js@2";

// Phase 1 #4 (29 Jul follow-up): each entry pairs a table with the column
// safe to paginate on. Was hardcoded to "created_at" for every table --
// login_attempts and daily_token_counters don't have that column at all,
// so backing them up (added in Phase 1 #2, just above) would have failed
// silently every single day (caught by the per-table try/catch below,
// reported as anyTableFailed, but easy to miss on a page nobody checks
// often).
const TABLES: { name: string; orderCol: string }[] = [
  { name: "patients", orderCol: "created_at" },
  { name: "visits", orderCol: "created_at" },
  { name: "prescriptions", orderCol: "created_at" },
  { name: "payments", orderCol: "created_at" },
  { name: "leads", orderCol: "created_at" },
  { name: "followups", orderCol: "created_at" },
  { name: "appointments", orderCol: "created_at" },
  { name: "deliveries", orderCol: "created_at" },
  { name: "inventory", orderCol: "created_at" },
  { name: "payment_adjustments", orderCol: "created_at" },  // overpayment refund/credit ledger (P0-6)
  { name: "login_attempts", orderCol: "updated_at" },        // no created_at -- table only has mobile/failed_count/locked_until/updated_at
  { name: "system_alerts", orderCol: "created_at" },         // degraded-mode alerts
  { name: "daily_token_counters", orderCol: "token_date" },  // no timestamp column at all -- token_date is the closest stable sort key
  { name: "webhook_hits", orderCol: "created_at" },          // JustDial webhook rate-limit tracking
];

// Phase 1 #4: was a flat .limit(3000) per table -- any table that grew
// past 3000 rows silently lost its oldest rows from the backup every day,
// with nothing in the response to say so. Now pages through the whole
// table in batches until exhausted. PAGE_CAP is a safety valve (not an
// expected real limit at clinic scale) so a runaway loop can't hang the
// function or blow past the Edge Function timeout -- if a table ever
// hits it, the response below flags it explicitly instead of silently
// truncating like before.
const PAGE_SIZE = 1000;
const PAGE_CAP = 50; // 50,000 rows/table ceiling -- revisit if any table gets this big

async function fetchAllRows(supabaseAdmin: any, table: string, orderCol: string): Promise<{ rows: any[]; capped: boolean }> {
  const rows: any[] = [];
  let page = 0;
  while (page < PAGE_CAP) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .order(orderCol, { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return { rows, capped: false };
    page++;
  }
  return { rows, capped: page >= PAGE_CAP };
}

// Plain === on secrets leaks timing information (an attacker can narrow
// down the correct value character-by-character from response latency).
// This always compares every byte regardless of where the mismatch is.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    const expectedSecret = Deno.env.get("BACKUP_FUNCTION_SECRET");
    const gotSecret = req.headers.get("x-backup-secret") ?? "";
    if (!expectedSecret || !constantTimeEqual(gotSecret, expectedSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const sheetsUrl = Deno.env.get("BACKUP_SHEETS_URL");
    if (!sheetsUrl) {
      return new Response(JSON.stringify({ error: "BACKUP_SHEETS_URL not configured as a secret" }), { status: 500 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const backup: Record<string, any[]> = {};
    let anyTableFailed = false;
    const cappedTables: string[] = [];
    for (const { name, orderCol } of TABLES) {
      try {
        const { rows, capped } = await fetchAllRows(supabaseAdmin, name, orderCol);
        backup[name] = rows;
        if (capped) cappedTables.push(name);
      } catch (e: any) {
        backup[name] = [{ ERROR: e?.message ?? String(e) }];
        anyTableFailed = true;
      }
    }

    const res = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    const result = await res.json().catch(() => ({}));

    // A partial-table failure must not be reported as a clean success —
    // that would let a broken backup sit unnoticed until it's needed. A
    // capped table (hit PAGE_CAP) is also not a clean success — it means
    // pagination stopped early and some rows are missing, same as the old
    // silent-truncation bug would have caused.
    const success = res.ok && result.success && !anyTableFailed && cappedTables.length === 0;
    return new Response(
      JSON.stringify({ success, tables: Object.keys(backup), anyTableFailed, cappedTables, sheetsResponse: result }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
