-- ============================================================================
-- YHC-OS — Staff Login Lockout — Audit P1-14
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- Backs the staff-signin Edge Function: 5 failed attempts on a mobile
-- number locks it for 15 minutes. Enforced server-side in the edge
-- function, not here — this table is just the counter.
-- ============================================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  mobile text PRIMARY KEY,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- VERIFY:
-- select * from login_attempts order by updated_at desc limit 10;
