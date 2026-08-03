-- 0021 — Nightly Data-Health check function (Phase 3 decision #28, 29 Jul 2026)
--
-- Decision: "Confirmed — banega. Har raat automatic check, subah Owner ko
-- alert agar kuch gadbad mile."
--
-- Lives as a Postgres function (not just app-level checks, unlike the
-- existing manual "Run Health Check Now" button on Owner > System Health,
-- which only checks connectivity + row counts from the browser) because
-- several of these checks — reading cron.job, comparing across tables —
-- are naturally a SQL job and this keeps the nightly Edge Function thin:
-- it just calls this once and decides whether to raise a system_alerts row.
--
-- NOTE: run this in Supabase SQL Editor, same as 0001-0020.

create or replace function public.run_nightly_data_health()
returns jsonb
language plpgsql
as $$
declare
  v_stale_visits int;
  v_wa_failed_24h int;
  v_wa_sent_24h int;
  v_dup_settings int;
  v_orphan_visits int;
  v_expected_crons text[] := array[
    'daily-backup', 'backup-storage-to-drive', 'daily-whatsapp-reminders',
    'whatsapp-winback', 'whatsapp-holiday-greetings', 'whatsapp-birthday-anniversary'
  ];
  v_missing_crons text[];
  v_checks jsonb := '[]'::jsonb;
  v_has_issue boolean := false;
begin
  -- 1) Visits stuck open (not DONE) for 30+ days -- same definition
  -- fetchStaleOpenVisits() already uses on the Owner > System Health page.
  select count(*) into v_stale_visits
  from public.visits
  where visit_status <> 'DONE' and visit_date < (now() - interval '30 days');
  v_checks := v_checks || jsonb_build_object(
    'check', 'stale_open_visits', 'status', case when v_stale_visits > 0 then 'WARN' else 'PASS' end,
    'value', v_stale_visits
  );
  if v_stale_visits > 0 then v_has_issue := true; end if;

  -- 2) WhatsApp failure rate, last 24h (whatsapp_log -- migration 0019).
  select count(*) filter (where status = 'failed'), count(*) filter (where status = 'sent')
  into v_wa_failed_24h, v_wa_sent_24h
  from public.whatsapp_log
  where created_at > now() - interval '24 hours';
  v_checks := v_checks || jsonb_build_object(
    'check', 'whatsapp_failures_24h',
    'status', case when v_wa_failed_24h > 5 and v_wa_failed_24h > v_wa_sent_24h then 'FAIL'
                    when v_wa_failed_24h > 0 then 'WARN' else 'PASS' end,
    'value', jsonb_build_object('failed', v_wa_failed_24h, 'sent', v_wa_sent_24h)
  );
  if v_wa_failed_24h > 5 and v_wa_failed_24h > v_wa_sent_24h then v_has_issue := true; end if;

  -- 3) Every expected cron job present AND active (pg_cron).
  select array_agg(x) into v_missing_crons
  from unnest(v_expected_crons) x
  where not exists (
    select 1 from cron.job where jobname = x and active
  );
  v_checks := v_checks || jsonb_build_object(
    'check', 'cron_jobs',
    'status', case when v_missing_crons is not null and array_length(v_missing_crons, 1) > 0 then 'FAIL' else 'PASS' end,
    'value', coalesce(to_jsonb(v_missing_crons), '[]'::jsonb)
  );
  if v_missing_crons is not null and array_length(v_missing_crons, 1) > 0 then v_has_issue := true; end if;

  -- 4) Settings duplicate keys (the exact race condition 0018 fixed --
  -- confirms the unique constraint is still in place and working).
  select count(*) into v_dup_settings
  from (select key from public.settings group by key having count(*) > 1) d;
  v_checks := v_checks || jsonb_build_object(
    'check', 'duplicate_settings_keys', 'status', case when v_dup_settings > 0 then 'FAIL' else 'PASS' end,
    'value', v_dup_settings
  );
  if v_dup_settings > 0 then v_has_issue := true; end if;

  -- 5) Orphan visits (patient_id pointing nowhere -- data integrity).
  select count(*) into v_orphan_visits
  from public.visits v
  where not exists (select 1 from public.patients p where p.id = v.patient_id);
  v_checks := v_checks || jsonb_build_object(
    'check', 'orphan_visits', 'status', case when v_orphan_visits > 0 then 'FAIL' else 'PASS' end,
    'value', v_orphan_visits
  );
  if v_orphan_visits > 0 then v_has_issue := true; end if;

  return jsonb_build_object('has_issue', v_has_issue, 'checks', v_checks, 'run_at', now());
end;
$$;

-- Schedule: 6:00 AM IST daily = 12:30 AM UTC = '30 0 * * *'
-- (IST = UTC + 5:30, same conversion already used for the WhatsApp crons
-- in migration 0013 and documented there.)
select cron.schedule(
  'nightly-data-health',
  '30 0 * * *',
  $cmd$
select net.http_post(
  url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/nightly-data-health',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := '{}'::jsonb
) as request_id;
$cmd$
);

-- VERIFY — should list the new job, active = true:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'nightly-data-health';
--
-- To test the check logic itself right now, without waiting for 6 AM:
-- select run_nightly_data_health();
