// Auto-syncs new JustDial leads from a published Google Sheet CSV into the
// `leads` table — Dr. Yadav's real workflow: JustDial leads land in a
// Google Sheet via IMPORTRANGE (out of this app's control), and they want
// the app's Lead CRM to pick up new rows automatically, the same way
// IMPORTRANGE itself keeps a sheet in sync, instead of a manual CSV
// upload every time.
//
// Cron-invoked, every 15 min (see migration 0064). Same shared-secret
// pattern as the other cron functions (whatsapp-daily-reminders,
// nightly-data-health, backup-to-sheets) — inlined here, not imported from
// _shared/, because the MCP deploy path doesn't resolve relative imports
// (see checkCampaignGate's history in the WhatsApp functions).
//
// PROGRESS TRACKING: settings.justdial_sheet_sync holds
// { csvUrl, lastRowCount, lastSyncAt, enabled }. The sheet is strictly
// append-only (IMPORTRANGE / form submissions always add to the bottom),
// so "rows after position lastRowCount" is exactly the new leads since the
// previous run — no need to diff full content or track per-row IDs.
//
// MAX_PER_RUN caps how many new rows one invocation processes, so a large
// backlog (e.g. a 32k-row historical sheet on first setup) can't time out
// a single run — lastRowCount advances by whatever was actually committed,
// so the next cron tick picks up exactly where this one left off.

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_PER_RUN = 4000;
const INSERT_BATCH = 500;
const MOBILE_CHECK_CHUNK = 300;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireCronSecret(req: Request): Response | null {
  const expected = Deno.env.get("CRON_FUNCTION_SECRET");
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected) {
    return new Response(JSON.stringify({ error: "Unauthorized: CRON_FUNCTION_SECRET not configured" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  if (!constantTimeEqual(got, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  return null;
}

// Same parser as parseCSV in src/lib/db.ts, ported here since Deno can't
// import from the app's client bundle.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function normalizeMobile(raw: string | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function findCol(headers: string[], ...aliases: string[]): number {
  const wanted = aliases.map(norm);
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(norm(headers[i]))) return i;
  }
  return -1;
}

async function raiseAlert(supabaseAdmin: any, message: string, context: Record<string, unknown>) {
  try {
    await supabaseAdmin.from("system_alerts").insert({ type: "JUSTDIAL_SHEET_SYNC", message, context });
  } catch {
    // Alert-logging must never break the response itself.
  }
}

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: settingsRow } = await supabaseAdmin.from("settings").select("value").eq("key", "justdial_sheet_sync").maybeSingle();
    if (!settingsRow?.value) {
      return new Response(JSON.stringify({ success: false, error: "justdial_sheet_sync setting not configured" }), { status: 200 });
    }
    let config: { csvUrl: string; lastRowCount: number; enabled: boolean };
    try {
      config = JSON.parse(settingsRow.value);
    } catch {
      await raiseAlert(supabaseAdmin, "justdial_sheet_sync setting value is not valid JSON", { raw: settingsRow.value });
      return new Response(JSON.stringify({ success: false, error: "invalid settings JSON" }), { status: 200 });
    }
    if (!config.enabled) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "sync disabled" }), { status: 200 });
    }

    const res = await fetch(config.csvUrl);
    if (!res.ok) {
      await raiseAlert(supabaseAdmin, `Sheet CSV fetch failed: HTTP ${res.status}`, { status: res.status });
      return new Response(JSON.stringify({ success: false, error: `fetch failed: ${res.status}` }), { status: 200 });
    }
    const text = await res.text();
    const allRows = parseCSV(text);
    if (allRows.length === 0) {
      await raiseAlert(supabaseAdmin, "Sheet CSV came back empty", {});
      return new Response(JSON.stringify({ success: false, error: "empty CSV" }), { status: 200 });
    }
    const headers = allRows[0];
    const dataRows = allRows.slice(1);

    const colDate = findCol(headers, "date");
    const colTime = findCol(headers, "time");
    const colName = findCol(headers, "name");
    const colMobile = findCol(headers, "mobile", "phone", "contact");
    const colCategory = findCol(headers, "category", "disease", "complaint");
    const colPincode = findCol(headers, "pincode", "pin code", "pin");
    const colArea = findCol(headers, "area", "location");

    if (colMobile === -1 || colName === -1) {
      await raiseAlert(supabaseAdmin, "Sheet header row missing Name/Mobile column — check if the sheet structure changed", { headers });
      return new Response(JSON.stringify({ success: false, error: "header missing name/mobile" }), { status: 200 });
    }

    const lastRowCount = config.lastRowCount ?? 0;
    const newRows = dataRows.slice(lastRowCount, lastRowCount + MAX_PER_RUN);

    if (newRows.length === 0) {
      await supabaseAdmin.from("settings").upsert({ key: "justdial_sheet_sync", value: JSON.stringify({ ...config, lastRowCount: dataRows.length, lastSyncAt: new Date().toISOString() }) }, { onConflict: "key" });
      return new Response(JSON.stringify({ success: true, imported: 0, upToDate: true, totalRowsInSheet: dataRows.length }), { status: 200 });
    }

    // Build candidate rows, deduped within this batch (the sheet itself has
    // repeat mobiles — same person searching JustDial more than once).
    const seen = new Set<string>();
    const candidates: { name: string; mobile: string; category: string; area: string; pincode: string; createdAt: string | null }[] = [];
    for (const r of newRows) {
      const mobile = normalizeMobile(r[colMobile]);
      const name = (r[colName] ?? "").trim();
      if (!name || mobile.length !== 10 || seen.has(mobile)) continue;
      seen.add(mobile);
      const dateStr = colDate >= 0 ? (r[colDate] ?? "").trim() : "";
      const timeStr = colTime >= 0 ? (r[colTime] ?? "").trim() : "";
      let createdAt: string | null = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const d = new Date(`${dateStr}T${/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr) ? timeStr : "00:00:00"}+05:30`);
        if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
      }
      candidates.push({
        name,
        mobile,
        category: colCategory >= 0 ? (r[colCategory] ?? "").trim() : "",
        area: colArea >= 0 ? (r[colArea] ?? "").trim() : "",
        pincode: colPincode >= 0 ? (r[colPincode] ?? "").trim() : "",
        createdAt,
      });
    }

    // Dedupe against existing leads AND patients (same rule the manual
    // Leads import already uses) — a JustDial lead who already registered
    // as a patient, or is already sitting in the lead list, shouldn't be
    // re-added.
    const known = new Set<string>();
    for (const table of ["leads", "patients"] as const) {
      const mobiles = Array.from(new Set(candidates.map((c) => c.mobile)));
      for (let i = 0; i < mobiles.length; i += MOBILE_CHECK_CHUNK) {
        const chunk = mobiles.slice(i, i + MOBILE_CHECK_CHUNK);
        const { data } = await supabaseAdmin.from(table).select("mobile").in("mobile", chunk);
        (data ?? []).forEach((row: any) => known.add(normalizeMobile(row.mobile)));
      }
    }

    const toInsert = candidates.filter((c) => !known.has(c.mobile));
    let imported = 0;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      const chunk = toInsert.slice(i, i + INSERT_BATCH).map((c) => ({
        name: c.name,
        mobile: c.mobile,
        lead_source: "JUSTDIAL",
        status: "NEW",
        lead_quality: "HOT",
        disease_interest: c.category || null,
        notes: c.area || c.pincode ? `${c.area}${c.area && c.pincode ? " " : ""}${c.pincode ? `(PIN ${c.pincode})` : ""}`.trim() : null,
        source_ref: "justdial_sheet_sync",
        // Every row in a bulk insert must carry the SAME keys — PostgREST
        // sends an explicit NULL for a key a sibling row has and this one
        // omits, rather than falling back to the column's own DEFAULT
        // now(). A mixed batch (some rows with a parsed sheet date, some
        // without) was hitting created_at's NOT NULL constraint. Falling
        // back to "now" here for unparseable dates keeps the key present
        // and valid on every row.
        created_at: c.createdAt ?? new Date().toISOString(),
        modified_at: c.createdAt ?? new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("leads").insert(chunk);
      if (error) {
        // Commit whatever succeeded before this chunk; report the rest as
        // not-yet-done so the next run retries from the correct watermark.
        await raiseAlert(supabaseAdmin, `Leads insert failed partway through: ${error.message}`, { importedSoFar: imported, chunkStart: i });
        break;
      }
      imported += chunk.length;
    }

    const newLastRowCount = lastRowCount + newRows.length;
    // Explicit onConflict:"key" is required — settings' primary key is
    // `id`, not `key` (key only has a separate UNIQUE constraint), so a
    // plain upsert() resolves conflicts against the wrong column and
    // silently fails to update the existing row. Found live 22 Sep 2026:
    // 8 consecutive runs all "succeeded" but the watermark never advanced
    // past 4000, so every run kept reprocessing (and correctly re-skipping)
    // the same first 4000 rows instead of making progress.
    const { error: settingsErr } = await supabaseAdmin.from("settings").upsert({
      key: "justdial_sheet_sync",
      value: JSON.stringify({ ...config, lastRowCount: newLastRowCount, lastSyncAt: new Date().toISOString() }),
    }, { onConflict: "key" });
    if (settingsErr) {
      await raiseAlert(supabaseAdmin, `Watermark update failed: ${settingsErr.message}`, { imported, newLastRowCount });
    }

    return new Response(JSON.stringify({
      success: true,
      processedRows: newRows.length,
      candidates: candidates.length,
      imported,
      duplicatesSkipped: candidates.length - toInsert.length,
      newLastRowCount,
      totalRowsInSheet: dataRows.length,
      remaining: Math.max(0, dataRows.length - newLastRowCount),
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    await raiseAlert(supabaseAdmin, `sync-justdial-leads crashed: ${String(e)}`, { error: String(e) });
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500 });
  }
});
