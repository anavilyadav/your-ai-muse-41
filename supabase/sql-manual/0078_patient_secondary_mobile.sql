-- 0078 — Patient secondary contact number (23 Sep 2026)
--
-- Dr. Yadav: some patients (especially children) are reachable on more
-- than one number — a mother's and a father's — and the current schema
-- only holds one mobile + one optional distinct WhatsApp number, both
-- describing a single contact identity. Adding one OPTIONAL second
-- contact (own label, number, country code, confirmed flag), not a full
-- multi-number system — deliberately scoped small per Dr. Yadav's own
-- call: this does NOT touch the WhatsApp-sending edge functions (they
-- keep sending to the primary mobile/WhatsApp target only), it's a
-- second reachable number staff can see and personally call/WhatsApp
-- from the patient's profile.

alter table patients
  add column if not exists secondary_mobile text,
  add column if not exists secondary_mobile_country_code text not null default '+91',
  add column if not exists secondary_mobile_label text,
  add column if not exists secondary_mobile_confirmed boolean not null default false;

insert into schema_migrations (filename, notes) values
  ('0078_patient_secondary_mobile', 'Adds secondary_mobile/secondary_mobile_country_code/secondary_mobile_label/secondary_mobile_confirmed to patients — one optional second contact number (e.g. Mother/Father for a child patient), visible/callable/WhatsApp-able from the profile, NOT wired into automated WhatsApp campaign sends')
on conflict (filename) do nothing;
