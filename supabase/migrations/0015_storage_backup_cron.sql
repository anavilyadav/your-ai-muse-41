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
-- ============================================================================

select cron.schedule(
  'backup-storage-to-drive',
  '0 18 * * *',
  $cmd$
select net.http_post(
  url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/backup-storage-to-drive',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-backup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'BACKUP_FUNCTION_SECRET')
  ),
  body := '{}'::jsonb
) as request_id;
$cmd$
);

-- NOTE: the header above assumes BACKUP_FUNCTION_SECRET is stored in
-- Supabase Vault under that exact name, matching whatever pattern the
-- existing backup-to-sheets cron job already uses for its own
-- x-backup-secret header (migration 0002) — copy that job's actual
-- header approach here if it differs from the vault lookup above; this
-- repo doesn't have visibility into how 0002 was ultimately run.

-- VERIFY:
-- select jobid, jobname, schedule, command from cron.job where jobname = 'backup-storage-to-drive';
