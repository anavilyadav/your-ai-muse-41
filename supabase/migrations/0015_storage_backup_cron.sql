-- ============================================================================
-- YHC-OS — Phase 1 item #15: Cron for backup-storage-to-drive
--
-- Supabase Cron runs in UTC. IST = UTC + 5:30. Scheduled 30 minutes after
-- the existing daily Sheets backup (11:00 PM IST) to avoid both running
-- at the exact same moment — 11:30 PM IST = 6:00 PM UTC = '0 18 * * *'.
--
-- Requires DRIVE_BACKUP_URL secret to be set (see apps-script-drive-upload.gs.txt
-- for what to deploy and where that URL comes from) before this does
-- anything useful — until then it'll just fail fast with a clear error in
-- the Edge Function logs, not silently no-op.
--
-- BEFORE RUNNING THIS: replace PASTE_YOUR_SECRET_HERE below with the
-- EXACT same value already set as the BACKUP_FUNCTION_SECRET Edge
-- Function secret (the same one backup-to-sheets already uses — see
-- migration 0002 for that one's header, confirmed working; this mirrors
-- it exactly rather than the Vault-lookup guess from an earlier draft).
-- ============================================================================

select cron.schedule(
  'backup-storage-to-drive',
  '0 18 * * *',
  $cmd$
select net.http_post(
  url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/backup-storage-to-drive',
  headers := '{"Content-Type": "application/json", "x-backup-secret": "PASTE_YOUR_SECRET_HERE"}'::jsonb,
  body := '{}'::jsonb
) as request_id;
$cmd$
);

-- VERIFY — headers should show your actual secret, not a placeholder:
-- select jobid, jobname, schedule, command from cron.job where jobname = 'backup-storage-to-drive';
