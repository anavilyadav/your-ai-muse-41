-- 0074 — Manual (backfill) date-entry mode default setting (23 Sep 2026)
--
-- Owner is catching up a few real days (Sun/Mon/Tue) of patients that
-- weren't in the bulk-imported sheet, one at a time through the normal
-- Register screen instead of another CSV import. Adds a settings row,
-- explicitly defaulted to 'false' so this mode is OFF unless the Owner
-- turns it on (the app-level toggle component this key feeds defaults
-- unset keys to true, which is wrong for a temporary backfill switch).

insert into settings (key, value) values ('manual_date_entry_enabled', 'false')
on conflict (key) do nothing;

insert into schema_migrations (filename, notes) values
  ('0074_manual_date_entry_setting', 'Adds manual_date_entry_enabled=false default settings row, feeding a new Owner-controlled toggle that lets Register/Check-in create a visit with a picked past date instead of always today, for one-time backfill catch-up entry')
on conflict (filename) do nothing;
