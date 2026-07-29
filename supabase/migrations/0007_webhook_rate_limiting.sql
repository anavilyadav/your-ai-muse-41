-- ============================================================================
-- YHC-OS — Webhook Rate Limiting — Audit P1-11 remainder
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- Backs justdial-lead-webhook's rate limit (20 requests/minute). The
-- function self-cleans this table on every hit, so no cron job needed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhook_hits (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_hits_source_time ON webhook_hits(source, created_at);

-- VERIFY:
-- select count(*) from webhook_hits where source = 'justdial' and created_at > now() - interval '1 minute';
