// Daily safety-net backup — copies key tables into a Google Sheet, so if
// Supabase/the app ever gets stuck, patient/business data is still readable
// and recoverable from Sheets (which the whole clinic already knows how to
// use, from the original YHC-OS days).
//
// Requires a secret: BACKUP_SHEETS_URL — the Google Apps Script Web App
// URL (see YHC-OS_Backup_AppsScript.gs deployment steps).

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

Deno.serve(async () => {
  try {
    const sheetsUrl = Deno.env.get("BACKUP_SHEETS_URL");
    if (!sheetsUrl) {
      return new Response(JSON.stringify({ error: "BACKUP_SHEETS_URL not configured as a secret" }), { status: 500 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const backup: Record<string, any[]> = {};
    for (const table of TABLES) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(3000);
      if (error) {
        backup[table] = [{ ERROR: error.message }];
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

    return new Response(
      JSON.stringify({ success: res.ok && result.success, tables: Object.keys(backup), sheetsResponse: result }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
