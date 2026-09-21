-- 0063 — Card number uniqueness is informational only, not a hard DB rule (21 Sep 2026)
--
-- Found live mid-import of Dr. Yadav's real 5998-row master sheet: after
-- 0062 fixed the stale single-column card_number UNIQUE constraint by
-- scoping it to the (series, register, number) triple, the import (now
-- resilient per-row after the earlier fix) still failed dozens of rows on
-- that composite constraint — but the colliding rows were clearly
-- DIFFERENT people (different names, different mobiles), not the same
-- patient entered twice. Real clinics commonly register one physical card
-- per FAMILY, with several distinct patients sharing its series/register/
-- number — so a hard uniqueness rule here rejects legitimate real data,
-- not just mistakes.
--
-- The app was never actually relying on a hard DB constraint for this —
-- isDuplicateCardNumber() in db.ts already does a soft pre-check used
-- interactively (Owner Patients, case-taking, dispensing) to WARN staff
-- before they save a card number, and the new data_quality_report() RPC
-- (0061) surfaces every duplicate_cards group for the Owner to review —
-- both were designed as advisory, not enforced. 0062 should have dropped
-- the old constraint outright instead of replacing it with a new one;
-- this finishes that.

alter table patients drop constraint if exists patients_card_series_register_number_key;

insert into schema_migrations (filename, notes) values
  ('0063_drop_card_number_hard_uniqueness', 'Drops the composite card-number UNIQUE constraint added in 0062 — real clinic data shares one card across a family, so duplicate detection stays advisory (isDuplicateCardNumber, Data Quality report) rather than DB-enforced')
on conflict (filename) do nothing;
