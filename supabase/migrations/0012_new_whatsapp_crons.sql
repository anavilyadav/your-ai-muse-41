-- ============================================================================
-- YHC-OS — 3 naye Cron jobs: Winback, Holiday Greetings, Birthday/Anniversary
-- ============================================================================
-- YAAD RAKHO: Supabase Cron hamesha UTC time mein chalta hai, IST mein nahi.
-- IST = UTC + 5:30. Isliye jo bhi IST time chahiye, usse 5:30 ghanta PEECHE
-- (minus) karke UTC schedule likhna padta hai. (Isi wajah se pichli session
-- mein reminders/backup galat time pe chal rahe the — yahan pehle se hi
-- sahi calculate karke di gayi hai.)
--
-- Teeno jobs subah 9:00 AM IST pe chalenge (jaisa whatsapp-daily-reminders
-- pehle se chalta hai) — 9:00 AM IST = 3:30 AM UTC = '30 3 * * *'
-- ============================================================================

-- 1) WINBACK — lapsed patients ko wapas bulane wala message
select cron.schedule(
  'whatsapp-winback',
  '30 3 * * *',
  $cmd$
select net.http_post(
  url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/whatsapp-winback',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := '{}'::jsonb
) as request_id;
$cmd$
);

-- 2) HOLIDAY GREETINGS — aaj koi holiday hai to sabko greeting
select cron.schedule(
  'whatsapp-holiday-greetings',
  '30 3 * * *',
  $cmd$
select net.http_post(
  url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/whatsapp-holiday-greetings',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := '{}'::jsonb
) as request_id;
$cmd$
);

-- 3) BIRTHDAY + ANNIVERSARY WISHES — ek hi function dono handle karta hai
select cron.schedule(
  'whatsapp-birthday-anniversary',
  '30 3 * * *',
  $cmd$
select net.http_post(
  url := 'https://swekxnhvecrcpiuteqmj.supabase.co/functions/v1/whatsapp-birthday-anniversary',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := '{}'::jsonb
) as request_id;
$cmd$
);

-- ============================================================================
-- VERIFY — teeno naye jobs list mein dikhne chahiye, schedule = '30 3 * * *'
-- ============================================================================
select jobid, jobname, schedule, command
from cron.job
where jobname in ('whatsapp-winback', 'whatsapp-holiday-greetings', 'whatsapp-birthday-anniversary');
