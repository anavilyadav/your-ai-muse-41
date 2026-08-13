-- ============================================================================
-- YHC-OS — WhatsApp master/module switches + daily send caps — 10 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run.
--
-- WHY
-- Dr. Yadav is about to bulk-import a large amount of historical patient
-- data (daily-entry + master sheets). The 4 automatic WhatsApp crons
-- (daily reminders, birthday/anniversary, holiday greetings, win-back)
-- decide who to message based on dates already sitting in the data —
-- imported due-dates/birthdays/last-visit-dates could make hundreds of
-- real patients look "due" for a message the very next time a cron runs.
-- Explicit requirements (10 Aug 2026): stay fully automatic day to day,
-- but be able to instantly pause everything (or just one campaign type)
-- during testing, cap the per-day send count per campaign to control
-- AiSensy cost, and snap back to full-automatic in one action — with
-- every skip visible on the dashboard, never silent.
--
-- Settings key `whatsapp_controls` shape:
--   {
--     "masterEnabled": true,
--     "modules": {
--       "REGISTRATION_CONFIRM": { "enabled": true, "dailyCap": null },
--       "APPOINTMENT_REMINDER": { "enabled": true, "dailyCap": null },
--       "FOLLOWUP_REMINDER":    { "enabled": true, "dailyCap": null },
--       "BIRTHDAY_WISH":        { "enabled": true, "dailyCap": null },
--       "ANNIVERSARY_WISH":     { "enabled": true, "dailyCap": null },
--       "HOLIDAY_GREETING":     { "enabled": true, "dailyCap": null },
--       "WINBACK":              { "enabled": true, "dailyCap": null }
--     }
--   }
-- dailyCap: null = unlimited (same "blank = unlimited" convention already
-- used for appointment slot daily caps, migration 0035).
-- ============================================================================

alter table public.whatsapp_log
  drop constraint if exists whatsapp_log_status_check;

alter table public.whatsapp_log
  add constraint whatsapp_log_status_check
  check (status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped_consent'::text, 'skipped_disabled'::text, 'skipped_cap'::text]));
