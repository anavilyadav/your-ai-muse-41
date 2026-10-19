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

// Welcome WhatsApp for each new lead goes through lead-flow-send (19 Oct
// 2026) — it picks the category template, checks the switches, and only
// ever welcomes leads created in the last 3 days.
async function sendWelcome(leadIds: string[]) {
  const secret = Deno.env.get("CRON_FUNCTION_SECRET");
  if (!secret || leadIds.length === 0) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lead-flow-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ leadIds, template: "WELCOME" }),
    });
  } catch {
    // Leads are saved; a WhatsApp hiccup must not fail the sync.
  }
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

    // Build candidate rows — every valid occurrence in this batch, NOT
    // deduped yet (16 Oct 2026 fix: the sheet's repeat mobiles used to be
    // silently dropped here, which is why total leads (~31k) never
    // matched the sheet's total row count (~33k) — Dr. Yadav caught this
    // live. A repeat mobile still only gets ONE lead row (below), but
    // every occurrence is now kept so the repeat-enquiry badge can show
    // what was searched and when, each time.
    const allOccurrences: { name: string; mobile: string; category: string; area: string; pincode: string; createdAt: string | null }[] = [];
    for (const r of newRows) {
      const mobile = normalizeMobile(r[colMobile]);
      const name = (r[colName] ?? "").trim();
      if (!name || mobile.length !== 10) continue;
      const dateStr = colDate >= 0 ? (r[colDate] ?? "").trim() : "";
      const timeStr = colTime >= 0 ? (r[colTime] ?? "").trim() : "";
      let createdAt: string | null = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const d = new Date(`${dateStr}T${/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr) ? timeStr : "00:00:00"}+05:30`);
        if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
      }
      allOccurrences.push({
        name,
        mobile,
        category: colCategory >= 0 ? (r[colCategory] ?? "").trim() : "",
        area: colArea >= 0 ? (r[colArea] ?? "").trim() : "",
        pincode: colPincode >= 0 ? (r[colPincode] ?? "").trim() : "",
        createdAt,
      });
    }

    // Mobiles already a lead or a patient (same rule the manual Leads
    // import already uses) — a JustDial search by someone already in the
    // system shouldn't create a second lead card, but IS a repeat enquiry.
    const known = new Set<string>();
    for (const table of ["leads", "patients"] as const) {
      const mobiles = Array.from(new Set(allOccurrences.map((c) => c.mobile)));
      for (let i = 0; i < mobiles.length; i += MOBILE_CHECK_CHUNK) {
        const chunk = mobiles.slice(i, i + MOBILE_CHECK_CHUNK);
        const { data } = await supabaseAdmin.from(table).select("mobile").in("mobile", chunk);
        (data ?? []).forEach((row: any) => known.add(normalizeMobile(row.mobile)));
      }
    }

    // First occurrence per mobile (that isn't already known) becomes the
    // lead row; every other occurrence — same mobile searching again
    // within this batch, or a mobile already known — is a repeat enquiry.
    const claimedThisBatch = new Set<string>();
    const toInsert: typeof allOccurrences = [];
    const repeatLog: typeof allOccurrences = [];
    for (const occ of allOccurrences) {
      if (known.has(occ.mobile) || claimedThisBatch.has(occ.mobile)) {
        repeatLog.push(occ);
      } else {
        claimedThisBatch.add(occ.mobile);
        toInsert.push(occ);
      }
    }

    // Idempotent: a sheet row already stored — as the lead's own row or as
    // an earlier repeat — is skipped, so re-scanning from row 0 (the
    // backfill of repeats dropped before 0088) never double-counts.
    // Counted as a multiset because the sheet has rows that repeat the
    // same mobile at the very same second.
    const alreadyStored = new Map<string, number>();
    const keyOf = (mobile: string, iso: string) => `${mobile}|${new Date(iso).getTime()}`;
    const bump = (k: string) => alreadyStored.set(k, (alreadyStored.get(k) ?? 0) + 1);
    const repeatMobiles = Array.from(new Set(repeatLog.map((c) => c.mobile)));
    for (let i = 0; i < repeatMobiles.length; i += MOBILE_CHECK_CHUNK) {
      const chunk = repeatMobiles.slice(i, i + MOBILE_CHECK_CHUNK);
      const [{ data: leadRows, error: e1 }, { data: repeatRows, error: e2 }] = await Promise.all([
        supabaseAdmin.from("leads").select("mobile, created_at").in("mobile", chunk),
        supabaseAdmin.from("lead_repeat_enquiries").select("mobile, occurred_at").in("mobile", chunk).limit(10000),
      ]);
      if (e1 || e2) {
        await raiseAlert(supabaseAdmin, `Repeat-enquiry lookup failed: ${(e1 ?? e2)!.message}`, {});
        return new Response(JSON.stringify({ success: false, error: "repeat lookup failed" }), { status: 500 });
      }
      (leadRows ?? []).forEach((r: any) => bump(keyOf(normalizeMobile(r.mobile), r.created_at)));
      (repeatRows ?? []).forEach((r: any) => bump(keyOf(r.mobile, r.occurred_at)));
    }
    const newRepeats = repeatLog.filter((c) => {
      if (!c.createdAt) return true;
      const k = keyOf(c.mobile, c.createdAt);
      const n = alreadyStored.get(k) ?? 0;
      if (n > 0) { alreadyStored.set(k, n - 1); return false; }
      return true;
    });

    for (let i = 0; i < newRepeats.length; i += INSERT_BATCH) {
      const chunk = newRepeats.slice(i, i + INSERT_BATCH).map((c) => ({
        mobile: c.mobile,
        disease_interest: c.category || null,
        source: "JUSTDIAL",
        occurred_at: c.createdAt ?? new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("lead_repeat_enquiries").insert(chunk);
      if (error) {
        // Watermark not advanced: the next run retries this batch, and the
        // skip above keeps whatever did get inserted from doubling.
        await raiseAlert(supabaseAdmin, `Repeat-enquiry insert failed: ${error.message}`, { chunkStart: i });
        return new Response(JSON.stringify({ success: false, error: "repeat insert failed" }), { status: 500 });
      }
    }

    let imported = 0;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      const chunk = toInsert.slice(i, i + INSERT_BATCH).map((c) => ({
        name: c.name,
        mobile: c.mobile,
        lead_source: "JUSTDIAL",
        status: "NEW",
        // WARM, not HOT (16 Oct 2026) — found live: with ~100% of leads
        // being JustDial and every one hardcoded HOT, the "HOT" stat/
        // filter in Lead CRM had become meaningless (Total === HOT,
        // always). Matches external-lead-webhook's existing "conservative
        // default — Owner can bump to HOT from the Manage panel" pattern.
        // A genuinely hot signal (the lead replying) now sets HOT itself —
        // see aisensy-whatsapp-status's inbound-reply handling.
        lead_quality: "WARM",
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
        // auto_touch_count: 1 = welcome step done (sent or not); follow-ups
        // only start once wa_welcome_sent_at is set — see lead-touch-sequencer.
        auto_touch_count: 1,
      }));
      // .select() added (12 Oct 2026) so the just-inserted rows' ids come
      // back in one round-trip — needed to send/log LEAD_WELCOME per lead.
      const { data: inserted, error } = await supabaseAdmin.from("leads").insert(chunk).select("id, name, mobile");
      if (error) {
        // Commit whatever succeeded before this chunk; report the rest as
        // not-yet-done so the next run retries from the correct watermark.
        await raiseAlert(supabaseAdmin, `Leads insert failed partway through: ${error.message}`, { importedSoFar: imported, chunkStart: i });
        break;
      }
      imported += chunk.length;

      await sendWelcome((inserted ?? []).map((l: any) => l.id));
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
      candidates: allOccurrences.length,
      imported,
      repeatEnquiriesLogged: newRepeats.length,
      repeatAlreadyStored: repeatLog.length - newRepeats.length,
      newLastRowCount,
      totalRowsInSheet: dataRows.length,
      remaining: Math.max(0, dataRows.length - newLastRowCount),
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    await raiseAlert(supabaseAdmin, `sync-justdial-leads crashed: ${String(e)}`, { error: String(e) });
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500 });
  }
});
