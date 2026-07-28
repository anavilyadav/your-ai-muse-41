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

const TABLES = [
  "patients",
  "visits",
  "prescriptions",
  "payments",
  "leads",
  "followups",
  "appointments",
  "deliveries",
  "inventory",
];

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
    for (const table of TABLES) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(3000);
      if (error) {
        backup[table] = [{ ERROR: error.message }];
        anyTableFailed = true;
      } else {
        backup[table] = data ?? [];
      }
    }

    const res = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    const result = await res.json().catch(() => ({}));

    // A partial-table failure must not be reported as a clean success —
    // that would let a broken backup sit unnoticed until it's needed.
    const success = res.ok && result.success && !anyTableFailed;
    return new Response(
      JSON.stringify({ success, tables: Object.keys(backup), anyTableFailed, sheetsResponse: result }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
