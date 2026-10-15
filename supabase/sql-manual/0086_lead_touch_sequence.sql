-- 0086 — Lead WhatsApp auto-touch sequence (12 Oct 2026)
--
-- Dr. Yadav's request: a lead should get an automatic WhatsApp nudge on a
-- schedule (not just the one-time LEAD_WELCOME) until either they respond
-- (a human logs a call — see auto_touch_count's stop condition in
-- lead-touch-sequencer), go DND, convert, or the sequence runs out.
--
-- auto_touch_count tracks how many automated touches a lead has had.
-- Touch 1 = LEAD_WELCOME, set by justdial-lead-webhook / external-lead-
-- webhook / meta-leadgen-webhook / sync-justdial-leads right after they
-- create the lead (whether or not the WhatsApp send itself went through —
-- the sequence clock starts at lead-creation time regardless). Touches
-- 2-5 are sent by the new lead-touch-sequencer cron function below, on a
-- tapering schedule (day 2 / 5 / 10 / 18 after creation) — see that
-- function for the exact day-offsets and the stop conditions.
alter table public.leads add column if not exists auto_touch_count integer not null default 0;

-- New campaign modules, explicitly DISABLED by default — unlike an
-- unlisted campaign's fallback (checkCampaignGate's DEFAULT_MODULE is
-- enabled:true), these are written into whatsapp_controls.modules here
-- with enabled:false on purpose, so flipping the master switch on for an
-- unrelated reason (e.g. re-enabling APPOINTMENT_REMINDER) can never
-- silently start this sequence too. Owner turns each one on individually
-- from Owner > WhatsApp once its AiSensy template is approved and the
-- wording's been reviewed.
update public.settings
set value = jsonb_set(
  value::jsonb,
  '{modules}',
  (value::jsonb->'modules') || '{"LEAD_TOUCH_2":{"enabled":false,"dailyCap":null},"LEAD_TOUCH_3":{"enabled":false,"dailyCap":null},"LEAD_TOUCH_4":{"enabled":false,"dailyCap":null},"LEAD_TOUCH_5":{"enabled":false,"dailyCap":null}}'::jsonb
)::text
where key = 'whatsapp_controls';

-- Same disabled-by-default treatment for LEAD_WELCOME (touch 1), which
-- justdial-lead-webhook/external-lead-webhook/meta-leadgen-webhook already
-- called checkCampaignGate("LEAD_WELCOME") for, but it was never actually
-- registered in whatsapp_controls.modules — meaning it silently fell back
-- to checkCampaignGate's DEFAULT_MODULE (enabled:true, no cap) the moment
-- the master switch was ever turned on for an unrelated reason. Found
-- while wiring up the rest of the sequence (12 Oct 2026) — closing it here
-- rather than leaving a pre-existing gap in place.
update public.settings
set value = jsonb_set(
  value::jsonb,
  '{modules}',
  (value::jsonb->'modules') || '{"LEAD_WELCOME":{"enabled":false,"dailyCap":null}}'::jsonb
)::text
where key = 'whatsapp_controls';

-- Runs every 30 min (lighter than sync-justdial-leads' 15 min — this isn't
-- racing a sheet watermark, a half-hour's slack on a multi-day schedule is
-- invisible). Same x-cron-secret / CRON_FUNCTION_SECRET pattern as every
-- other cron-invoked function in this project (0023).
select cron.schedule(
  'lead-touch-sequencer',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/lead-touch-sequencer',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "NYhqLTcCACt0wuql9DGGyDRBgSg31Q-C1Cu9cWql214"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

insert into schema_migrations (filename, notes) values
  ('0086_lead_touch_sequence', 'Adds leads.auto_touch_count, registers LEAD_TOUCH_2..5 as disabled-by-default WhatsApp campaign modules, schedules lead-touch-sequencer every 30 min')
on conflict (filename) do nothing;
