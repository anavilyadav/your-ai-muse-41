-- 0064 — JustDial Google Sheet auto-sync cron job (22 Sep 2026)
--
-- Dr. Yadav's real workflow: JustDial leads land in a Google Sheet via
-- IMPORTRANGE (outside this app), and the app should pick up new rows
-- automatically the same way IMPORTRANGE keeps a sheet in sync, instead
-- of a manual CSV upload every time.
--
-- sync-justdial-leads (deployed separately) reads settings.justdial_sheet_sync
-- ({ csvUrl, lastRowCount, lastSyncAt, enabled }), fetches the published
-- CSV, and imports any rows past lastRowCount as new JUSTDIAL leads
-- (deduped against existing leads/patients by mobile). Capped at 4000 rows
-- per run so a large backlog (this sheet had ~32k historical rows on
-- first setup) can't time out a single invocation — the watermark
-- advances by whatever was actually committed, so the next tick (15 min
-- later) continues the backfill until caught up, then settles into
-- picking up just the handful of new leads added each day.
--
-- Same x-cron-secret / CRON_FUNCTION_SECRET pattern as every other
-- cron-invoked function in this project (0023).

select cron.schedule(
  'sync-justdial-leads',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/sync-justdial-leads',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "NYhqLTcCACt0wuql9DGGyDRBgSg31Q-C1Cu9cWql214"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

insert into schema_migrations (filename, notes) values
  ('0064_justdial_sheet_sync_cron', 'Schedules sync-justdial-leads every 15 min to pull new JustDial leads from the Google Sheet CSV into the leads table')
on conflict (filename) do nothing;
