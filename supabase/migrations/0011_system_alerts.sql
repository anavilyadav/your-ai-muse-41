-- ============================================================================
-- YHC-OS — System Alerts (Degraded-Mode Detection) — Re-audit C-4, 29 Jul 2026
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- Several functions fall back to an older, less-safe path if their atomic
-- RPC is missing. That's intentional (keeps the clinic running instead of
-- hard-failing), but it used to be silent. This is just the storage table
-- — the actual logging happens in application code (logDegradedModeAlert
-- in db.ts), shown on the Owner Health page.
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  message text NOT NULL,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_unresolved ON system_alerts(resolved, created_at);

-- VERIFY:
-- select * from system_alerts order by created_at desc limit 10;
