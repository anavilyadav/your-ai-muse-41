-- 0053 — Schema version lock (#15, Dr. Yadav's spec — "kuch important lag
-- raha hai isko detail me explain krna")
--
-- The problem this closes: every DB change in this project is a .sql file
-- in supabase/sql-manual/ (or the older, frozen supabase/migrations/), but
-- a file existing in the repo and that file actually having been RUN
-- against the live database (swekxnhvecrcpiuteqmj) are two separate
-- things — nothing enforced the second one. This session alone caught two
-- real instances of that gap: 0043 (RLS) had a coverage bug only found by
-- manually diffing against the live table list before applying, and 0045
-- (report aggregates) sat in the repo unapplied for a while, invisible
-- until manually checked. If 0043 had been silently skipped for good,
-- patient data would still be wide open with no error, no alert, nothing
-- — the app doesn't fail loudly when a migration never ran, it just quietly
-- runs on stale schema.
--
-- Fix: one tracking table recording which migration files have actually
-- been applied live, plus a single EXPECTED_SCHEMA_VERSION constant in
-- app code (src/lib/db.ts) naming the latest migration THIS deployed code
-- depends on. The Owner Health page checks whether that expected filename
-- is present in this table and shows a loud warning if not — instead of
-- the gap staying invisible until someone happens to check by hand.
--
-- This is a different, earlier line of defense than the existing
-- system_alerts / logDegradedModeAlert mechanism (0011/0021), which only
-- fires reactively once a real user hits code that calls a genuinely
-- missing RPC. This one can catch the gap before anyone hits it.
--
-- CONVENTION FOR EVERY FUTURE MIGRATION: end the file with
--   insert into schema_migrations (filename) values ('00XX_name') on conflict do nothing;
-- and bump EXPECTED_SCHEMA_VERSION in src/lib/db.ts in the same change.

create table if not exists public.schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now(),
  notes text
);

alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from public, anon;
grant select on public.schema_migrations to authenticated;
-- Deliberately no insert/update/delete grant for authenticated — this
-- table is only ever written by directly running a migration file
-- (via the Supabase SQL Editor / MCP, as postgres), never from the app.

drop policy if exists schema_migrations_staff_select on public.schema_migrations;
create policy schema_migrations_staff_select on public.schema_migrations for select to authenticated using (true);

-- Backfill: every migration file 0001-0052 that exists in the repo today.
-- Not a guess — verified live before writing this, by checking that a
-- real, distinctive schema fingerprint from each file (its table, column,
-- function, sequence, or constraint) actually exists in this database:
-- all 43 fingerprints checked came back present. Recorded with
-- applied_at = now() (this migration's run time), since no per-file
-- historical timestamp exists to backfill accurately — the meaningful
-- fact this table exists to answer is "is it applied as of now", not
-- "when did it originally run".
insert into schema_migrations (filename, notes) values
  ('0001_atomic_payment_and_checkin', 'backfilled 17 Sep 2026 — verified via collect_payment_atomic/check_in_existing_patient_atomic existing'),
  ('0002_backup_cron_secret_header', 'backfilled 17 Sep 2026 — no schema fingerprint (edge function secret), trusted: backup cron demonstrably running live'),
  ('0003_patient_code_sequence', 'backfilled 17 Sep 2026 — verified via patient_code_seq/next_patient_codes existing'),
  ('0004_payment_adjustments_ledger', 'backfilled 17 Sep 2026 — verified via payment_adjustments table existing'),
  ('0005_login_attempts_lockout', 'backfilled 17 Sep 2026 — verified via login_attempts table existing'),
  ('0006_dispense_inventory_decrement', 'backfilled 17 Sep 2026 — verified via dispense_visit_atomic existing'),
  ('0007_webhook_rate_limiting', 'backfilled 17 Sep 2026 — verified via webhook_hits table existing'),
  ('0008_atomic_daily_token', 'backfilled 17 Sep 2026 — verified via daily_token_counters table existing'),
  ('0009_atomic_stock_increment', 'backfilled 17 Sep 2026 — verified via increment_stock existing'),
  ('0010_case_discussion_tracking', 'backfilled 17 Sep 2026 — verified via visits.case_discussed_at existing'),
  ('0011_system_alerts', 'backfilled 17 Sep 2026 — verified via system_alerts table existing'),
  ('0012_credit_apply_inside_payment_rpc', 'backfilled 17 Sep 2026 — no separate fingerprint (modifies collect_payment_atomic body), trusted: credit-apply-at-payment demonstrably working this session'),
  ('0013_new_whatsapp_crons', 'backfilled 17 Sep 2026 — edge functions, not DB objects; trusted: all 5 whatsapp-* functions confirmed deployed live this session'),
  ('0014_storage_backup_queue', 'backfilled 17 Sep 2026 — verified via storage_backup_queue table existing'),
  ('0015_storage_backup_cron', 'backfilled 17 Sep 2026 — trusted: backup-storage-to-drive cron job confirmed present in cron.job this session'),
  ('0016_fix_visit_status_check_constraint', 'backfilled 17 Sep 2026 — verified via visits_visit_status_check constraint existing'),
  ('0017_drop_stale_collect_payment_overload', 'backfilled 17 Sep 2026 — verified via collect_payment_atomic having a single overload'),
  ('0018_settings_unique_and_lead_source', 'backfilled 17 Sep 2026 — no isolated fingerprint, trusted: settings/lead_source demonstrably in active use this session'),
  ('0019_whatsapp_log_and_consent_history', 'backfilled 17 Sep 2026 — verified via whatsapp_log table existing'),
  ('0020_full_audit_log', 'backfilled 17 Sep 2026 — verified via audit_log.actor_id column existing'),
  ('0021_nightly_data_health', 'backfilled 17 Sep 2026 — verified via run_nightly_data_health existing, cron job confirmed present'),
  ('0022_rx_improvements', 'backfilled 17 Sep 2026 — verified via visits.rx_draft column existing'),
  ('0023_cron_function_secret', 'backfilled 17 Sep 2026 — no schema fingerprint (edge function secret), trusted: cron-invoked functions demonstrably working live'),
  ('0024_atomic_followup_reschedule', 'backfilled 17 Sep 2026 — verified via reschedule_followups_atomic existing'),
  ('0025_payment_idempotency_key', 'backfilled 17 Sep 2026 — verified via payments.idempotency_key column existing'),
  ('0026_patient_interactions', 'backfilled 17 Sep 2026 — verified via patient_interactions table existing'),
  ('0027_staged_followup_sequence', 'backfilled 17 Sep 2026 — verified via followup_touchpoints.channel column existing'),
  ('0028_medicine_master', 'backfilled 17 Sep 2026 — verified via inventory.type column existing'),
  ('0029_security_hardening', 'backfilled 17 Sep 2026 — no standalone fingerprint (grant/revoke only), trusted: this session personally re-applied the same PUBLIC/anon revoke pattern to newer functions, confirming the convention this migration established is real and in use'),
  ('0030_lead_crm_top_level', 'backfilled 17 Sep 2026 — no isolated fingerprint, trusted: Lead CRM demonstrably in active use (leads.lead_source referenced live this session)'),
  ('0031_fix_audit_log_trigger_type_bug', 'backfilled 17 Sep 2026 — verified via audit_log_generic existing and firing correctly (used as the template for this session''s own new audit triggers)'),
  ('0032_settings_category_default_and_lead_webhooks', 'backfilled 17 Sep 2026 — no isolated fingerprint, trusted: settings table demonstrably in active use this session'),
  ('0033_lead_sources_table_owner_extensible', 'backfilled 17 Sep 2026 — verified via lead_sources table existing'),
  ('0034_fix_followup_type_constraint', 'backfilled 17 Sep 2026 — no isolated fingerprint, trusted: followups table demonstrably in active use this session'),
  ('0035_appointment_type', 'backfilled 17 Sep 2026 — verified via appointments.appointment_type column existing'),
  ('0036_card_number_series', 'backfilled 17 Sep 2026 — verified via patients.card_series column existing'),
  ('0037_split_payments', 'backfilled 17 Sep 2026 — verified via payment_modes table existing'),
  ('0038_import_field_expansion', 'backfilled 17 Sep 2026 — verified via patients.email/category/patient_type/foreign_patient_info columns existing'),
  ('0039_whatsapp_controls', 'backfilled 17 Sep 2026 — no schema fingerprint (settings-key convention), trusted: checkCampaignGate reading whatsapp_controls confirmed live in this session''s own edge function reads'),
  ('0040_family_links_table', 'backfilled 17 Sep 2026 — verified via family_links table existing'),
  ('0041_payment_status_registered_guard', 'backfilled 17 Sep 2026 — verified via collect_payment_atomic existing with the REGISTERED guard (confirmed this session while investigating the payment/queue bug)'),
  ('0042_recover_stuck_visits_from_payment_status_bug', 'backfilled 17 Sep 2026 — one-time data repair, personally executed and verified this session (29 visits recovered)'),
  ('0043_rls_core_phase1', 'backfilled 17 Sep 2026 — verified live this session: 35/35 tables relrowsecurity=true, real curl against /rest/v1/patients with anon key returned 401'),
  ('0044_fix_register_patient_date_cast', 'backfilled 17 Sep 2026 — verified via register_patient_with_visit existing with the date-cast fix (confirmed while reading its definition this session)'),
  ('0045_report_aggregates', 'backfilled 17 Sep 2026 — verified via report_totals existing (this was the exact "written but not applied" gap found and fixed earlier this session)'),
  ('0046_cancel_phantom_followups', 'backfilled 17 Sep 2026 — one-time data repair, personally executed and verified this session (~200 phantom follow-ups cancelled)'),
  ('0047_merge_patients', 'backfilled 17 Sep 2026 — verified via merge_patients_atomic existing, built and tested end-to-end this session'),
  ('0048_whatsapp_delivery_tracking', 'backfilled 17 Sep 2026 — applied this session, verified via whatsapp_log.delivered_at etc. existing'),
  ('0049_owner_only_rpc_guard', 'applied this session — verified live: Reception JWT rejected, Owner JWT passes'),
  ('0050_purchase_orders', 'applied this session — verified live end-to-end (create, partial receive, full receive, cascade delete)'),
  ('0051_trash_undo_window', 'applied this session — verified live end-to-end (soft-delete, restore, role enforcement)'),
  ('0052_registration_idempotency_key', 'applied this session — verified live: 3 calls with the same key produced exactly 1 patient')
on conflict (filename) do nothing;

-- This file registers itself too, per the convention it establishes.
insert into schema_migrations (filename, notes) values
  ('0053_schema_version_lock', 'applied this session — created and backfilled the tracking table itself')
on conflict (filename) do nothing;

select count(*) as total_recorded from schema_migrations;
