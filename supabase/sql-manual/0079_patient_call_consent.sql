-- 0079 — Patient call consent / DND (23 Sep 2026)
--
-- Dr. Yadav: wants Call and WhatsApp treated as two INDEPENDENT consent
-- flags ("alag alag") — a patient might be fine with a follow-up call
-- but not want WhatsApp, or vice versa — collected/confirmed at
-- Payment time, and visible + editable from the Doctor's prescribing
-- screen too. `wa_consent` already exists; this adds its Call
-- counterpart. Defaults to true (not false, unlike wa_consent) because
-- the app has always called every patient with no opt-out mechanism at
-- all until now — defaulting true preserves that existing behavior for
-- every current patient instead of silently muting all calls.

alter table patients
  add column if not exists call_consent boolean not null default true;

insert into schema_migrations (filename, notes) values
  ('0079_patient_call_consent', 'Adds patients.call_consent (default true) — independent of wa_consent, collected/edited from Payment, Patient Profile, and Doctor Rx Consult')
on conflict (filename) do nothing;
