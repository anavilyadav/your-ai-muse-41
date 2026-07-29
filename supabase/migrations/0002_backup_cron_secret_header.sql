-- ============================================================================
-- YHC-OS — Add x-backup-secret header to daily-backup cron job
-- Confirmed against your actual cron command (headers were '{}'::jsonb,
-- url ends in /functions/v1/backup-to-sheets) — no more guessing needed.
--
-- BEFORE RUNNING THIS: add the secret first —
--   Supabase Dashboard → Edge Functions → Secrets → Add new secret
--   Name:  BACKUP_FUNCTION_SECRET
--   Value: koi bhi lambi random string (password generator se bana lo)
--
-- Then replace PASTE_YOUR_SECRET_HERE below with that EXACT same value
-- before running this.
-- ============================================================================

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'daily-backup'),
  command := $cmd$
select net.http_post(
  url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/backup-to-sheets',
  headers := '{"Content-Type": "application/json", "x-backup-secret": "PASTE_YOUR_SECRET_HERE"}'::jsonb,
  body := '{}'::jsonb
) as request_id;
$cmd$
);

-- ============================================================================
-- Verify — headers should now show your secret, not '{}'
-- ============================================================================
select jobid, jobname, schedule, command
from cron.job
where jobname = 'daily-backup';
