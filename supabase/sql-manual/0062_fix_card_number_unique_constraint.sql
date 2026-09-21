-- 0062 — Fix stale card_number UNIQUE constraint (21 Sep 2026)
--
-- Found live while Dr. Yadav's real 5998-row master-sheet import was
-- running: "duplicate key value violates unique constraint
-- patients_card_number_key" killed the entire import.
--
-- patients_card_number_key was a plain UNIQUE(card_number) — left over
-- from BEFORE 0047's Series-Register-Number card redesign. The app's own
-- logic (isDuplicateCardNumber in db.ts, and its comment) has said since
-- 0047 that the same card NUMBER can legitimately repeat across different
-- series/registers ("Written together as e.g. B-10-12 ... The same card
-- number can legitimately repeat across different series/register
-- combinations, but the exact same (series, register, number) triple
-- existing twice is almost always a data-entry mistake") — but nobody ever
-- dropped the old single-column constraint enforcing the OLD, wrong rule.
-- At real clinic scale (~100 cards per register, many registers) this was
-- certain to collide on legitimate data, not just mistakes.
--
-- Fix: drop the single-column constraint, add the composite one the app
-- was already designed around. Postgres composite UNIQUE only rejects a
-- row when ALL THREE columns match a prior row exactly — any row missing
-- one of the three (very common; card assignment often happens later than
-- registration) never collides, since NULL <> NULL in a unique check.

alter table patients drop constraint if exists patients_card_number_key;

alter table patients
  add constraint patients_card_series_register_number_key
  unique (card_series, card_register, card_number);

insert into schema_migrations (filename, notes) values
  ('0062_fix_card_number_unique_constraint', 'Drops stale UNIQUE(card_number), adds correct UNIQUE(card_series, card_register, card_number) matching the app''s own card-number design')
on conflict (filename) do nothing;
