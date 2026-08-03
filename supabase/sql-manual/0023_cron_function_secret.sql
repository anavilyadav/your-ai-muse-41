-- ============================================================================
-- YHC-OS — Migration 0023
-- Block 2 (security, mechanical): give every cron-invoked Edge Function a
-- caller secret, WITHOUT ever writing that secret into a file in git.
--
-- NOTE ON LOCATION: this file lives in supabase/sql-manual/ rather than
-- supabase/migrations/, because that folder is now write-locked by the
-- Lovable migration tooling (which targets a different Supabase project
-- than this app's real one, swekxnhvecrcpiuteqmj). Numbering continues the
-- same sequence. Run it the same way as 0001-0022: paste into the Supabase
-- SQL Editor for swekxnhvecrcpiuteqmj and run.
--
-- WHY
-- Five Edge Functions were `Deno.serve(async () => {...})` — they never
-- looked at the incoming request, so any request to the (public, guessable)
-- function URL ran a full production job: whatsapp-winback,
-- whatsapp-holiday-greetings, whatsapp-birthday-anniversary,
-- whatsapp-daily-reminders and nightly-data-health. Anyone with a URL could
-- blast WhatsApp messages at every consenting patient, on repeat, on the
-- clinic's AiSensy credits. Those functions now require the x-cron-secret
-- header (supabase/functions/_shared/cron-auth.ts) and this migration
-- teaches their cron jobs to send it.
--
-- WHY NOT PASTE_YOUR_SECRET_HERE (as 0002 and 0015 do)
-- Those two require the real secret to be pasted into the .sql file before
-- running — and the file is in git. One accidental commit of an edited copy
-- leaks the secret protecting every patient record in the Sheets backup.
-- This migration reads the value from Supabase Vault at run time and builds
-- the cron command with it, so the secret lives in exactly one place and
-- this file stays safe to commit.
--
-- ============================================================================
-- BEFORE RUNNING — do these two things first, in this order:
--
-- 1. Generate ONE long random string (password generator, 40+ chars). Call
--    it <SECRET>. Save it where you keep BACKUP_FUNCTION_SECRET.
--
-- 2. Add it in BOTH places:
--    a) Supabase Dashboard -> Edge Functions -> Secrets -> Add new secret
--         Name:  CRON_FUNCTION_SECRET
--         Value: <SECRET>
--    b) Vault (so this migration can read it). Run this ONE line in the SQL
--       editor, replacing <SECRET>, and do NOT save that line to a file:
--
--         select vault.create_secret('<SECRET>', 'cron_function_secret');
--
--    Both must hold the exact same value: (a) is what the function compares
--    against, (b) is what this migration puts in the cron header.
--
-- Then run this whole file. It is safe to re-run (it re-derives every
-- command from the Vault value each time).
-- ============================================================================

do $$
declare
  v_secret  text;
  v_base    text := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/';
  v_fn      text;
  v_jobname text;
  v_cmd     text;
  v_jobid   bigint;
  i         int;
  -- jobname -> function name. Job names must match what is already in
  -- cron.job; the verification query at the bottom shows any that didn't
  -- match, rather than failing silently.
  v_map text[][] := array[
    ['whatsapp-winback',              'whatsapp-winback'],
    ['whatsapp-holiday-greetings',    'whatsapp-holiday-greetings'],
    ['whatsapp-birthday-anniversary', 'whatsapp-birthday-anniversary'],
    ['whatsapp-daily-reminders',      'whatsapp-daily-reminders'],
    ['nightly-data-health',           'nightly-data-health']
  ];
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_function_secret';

  if v_secret is null then
    raise exception
      'Vault secret "cron_function_secret" not found. Run: select vault.create_secret(''<SECRET>'', ''cron_function_secret''); first — see the header of this file.';
  end if;

  for i in 1 .. array_length(v_map, 1) loop
    v_jobname := v_map[i][1];
    v_fn      := v_map[i][2];

    select jobid into v_jobid from cron.job where jobname = v_jobname;

    -- jsonb_build_object escapes the secret properly instead of
    -- string-concatenating it into JSON, so a secret containing " or \
    -- can't corrupt the header.
    v_cmd := format(
      $cmd$select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) as request_id;$cmd$,
      v_base || v_fn,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      )::text
    );

    if v_jobid is null then
      raise notice 'Cron job "%" does not exist yet — skipping (create it first, then re-run this file).', v_jobname;
    else
      perform cron.alter_job(job_id := v_jobid, command := v_cmd);
      raise notice 'Updated cron job "%" with x-cron-secret header.', v_jobname;
    end if;
  end loop;
end
$$;

-- ============================================================================
-- VERIFY — every row below should show has_secret_header = true.
-- Any job listed in the migration but missing here needs to be created
-- first (see migration 0013 / 0021), then re-run this file.
-- ============================================================================
select
  jobname,
  schedule,
  (command like '%x-cron-secret%') as has_secret_header
from cron.job
where jobname in (
  'whatsapp-winback',
  'whatsapp-holiday-greetings',
  'whatsapp-birthday-anniversary',
  'whatsapp-daily-reminders',
  'nightly-data-health'
)
order by jobname;
