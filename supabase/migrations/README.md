# Database Migrations

This folder is the source of truth for schema changes that have been run
against the live Supabase project (`swekxnhvecrcpiuteqmj`). Files here are
numbered in the order they were actually run.

## Why this exists (29 Jul 2026)

Until today, SQL migrations were delivered as standalone files outside git
(via Claude chat sessions) and run directly in the Supabase SQL Editor —
never committed here. A re-audit on 29 Jul 2026 correctly flagged this as
the single biggest structural risk in the project: the app depends on 9+
Postgres functions and 3+ tables that existed nowhere in version control.
If the database ever needed to be restored or rebuilt, there was no record
of how to reproduce it.

**Known gap:** this folder captures every migration from the 29 Jul 2026
session forward. It does NOT include the original bootstrap schema (the
initial `patients`, `visits`, `payments`, `leads`, etc. table definitions
from earlier in the project, before this migrations practice started) —
that history was never captured anywhere and can't be reconstructed
retroactively without reading the live schema directly.

## Going forward

**Every new SQL change must land in this folder** — either committed
directly here before being run, or added immediately after, in the same
session it was run. Number new files sequentially (`0008_...`, `0009_...`).

## Files in this folder

| File | What it does |
|---|---|
| `0001_atomic_payment_and_checkin.sql` | `collect_payment_atomic` + `check_in_existing_patient_atomic` RPCs (audit P0 #1, #2, #3, #4, #7) |
| `0002_backup_cron_secret_header.sql` | Adds `x-backup-secret` header to the daily-backup cron job |
| `0003_patient_code_sequence.sql` | `patient_code_seq` + `next_patient_codes()` — atomic patient code generation (audit P0-3 remainder) |
| `0004_payment_adjustments_ledger.sql` | `payment_adjustments` table + trigger + resolve/apply/revert RPCs — overpayment ledger (audit P0-6) |
| `0005_login_attempts_lockout.sql` | `login_attempts` table backing staff PIN lockout (audit P1-14) |
| `0006_dispense_inventory_decrement.sql` | `dispense_visit_atomic()` — atomic dispense + inventory decrement (audit P0-5) |
| `0007_webhook_rate_limiting.sql` | `webhook_hits` table backing JustDial webhook rate-limiting (audit P1-11) |
| `0008_atomic_daily_token.sql` | `daily_token_counters` + `next_token_for_day()` — atomic token generation, same race class as patient_code (re-audit finding) |
| `0009_atomic_stock_increment.sql` | `increment_stock()` — atomic stock-add, fixes read-modify-write race (re-audit finding) |
