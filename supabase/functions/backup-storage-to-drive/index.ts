// Phase 1 #15 — Storage → Google Drive backup.
//
// case-photos and patient-documents (Supabase Storage buckets) were never
// covered by the daily backup-to-sheets function — Sheets can't hold
// image files. This drains storage_backup_queue (see migration 0014 —
// every successful upload in src/lib/db.ts enqueues one row there) and
// uploads each pending file to Google Drive via a small Apps Script Web
// App, same integration pattern as the existing Sheets backup.
//
// Requires two secrets:
//   DRIVE_BACKUP_URL      — the Google Apps Script Web App URL (Drive upload)
//   BACKUP_FUNCTION_SECRET — reuses the SAME secret as backup-to-sheets;
//                            the Cron job sends it back in x-backup-secret.
//
// See supabase/functions/backup-storage-to-drive/apps-script-drive-upload.gs.txt
// for the Apps Script source to paste-deploy (this function only calls
// that URL, it can't deploy it).

import { createClient } from "npm:@supabase/supabase-js@2";

// Kept small so one invocation stays well inside Edge Function time
// limits even for large images. If there's ever a big backlog (e.g. after
// enabling this for the first time on an existing photo library), the
// daily cron just catches up gradually over several days — `remaining`
// in the response tells you how much is left.
const BATCH_SIZE = 25;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Converts file bytes to base64 in chunks — spreading a large Uint8Array
// directly into String.fromCharCode(...bytes) can blow the call stack for
// anything more than a few hundred KB, which a case photo easily is.
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  try {
    const expectedSecret = Deno.env.get("BACKUP_FUNCTION_SECRET");
    const gotSecret = req.headers.get("x-backup-secret") ?? "";
    if (!expectedSecret || !constantTimeEqual(gotSecret, expectedSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const driveUrl = Deno.env.get("DRIVE_BACKUP_URL");
    if (!driveUrl) {
      return new Response(JSON.stringify({ error: "DRIVE_BACKUP_URL not configured as a secret" }), { status: 500 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pending, error: qErr } = await supabaseAdmin
      .from("storage_backup_queue")
      .select("id, bucket, path, attempts")
      .eq("synced", false)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (qErr) return new Response(JSON.stringify({ error: qErr.message }), { status: 400 });

    let synced = 0, failed = 0;
    for (const item of pending ?? []) {
      try {
        const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage.from(item.bucket).download(item.path);
        if (dlErr || !fileBlob) throw new Error(dlErr?.message ?? "download from storage failed");
        const bytes = new Uint8Array(await fileBlob.arrayBuffer());

        const res = await fetch(driveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucket: item.bucket,
            path: item.path,
            contentBase64: uint8ToBase64(bytes),
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.success) throw new Error(result?.error ?? `Drive upload failed (HTTP ${res.status})`);

        await supabaseAdmin
          .from("storage_backup_queue")
          .update({ synced: true, synced_at: new Date().toISOString() })
          .eq("id", item.id);
        synced++;
      } catch (e: any) {
        failed++;
        await supabaseAdmin
          .from("storage_backup_queue")
          .update({ attempts: (item.attempts ?? 0) + 1, last_error: String(e?.message ?? e) })
          .eq("id", item.id);
      }
    }

    const { count: remaining } = await supabaseAdmin
      .from("storage_backup_queue")
      .select("id", { count: "exact", head: true })
      .eq("synced", false);

    return new Response(
      JSON.stringify({ success: failed === 0, synced, failed, remaining: remaining ?? 0 }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
