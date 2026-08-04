-- ============================================================================
-- YHC-OS — Staged follow-up sequence (Day 0/2/5/9/14/19/25) — 04 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (guarded INSERT, IF NOT EXISTS/CREATE OR REPLACE throughout).
--
-- Locked decision (Phase 3): Day 0 Call, Day 2 WhatsApp, Day 5 Call, Day 9
-- WhatsApp, Day 14 Call, Day 19 WhatsApp, Day 25 final Call.
--
-- Existing followup_touchpoints already implements a real multi-tier
-- PRE-due-date reminder system (16 rules, gap-bracket-scoped, e.g. "1
-- month: 15d/7d/2d before") -- NOT the "single flat reminder" some earlier
-- notes described (that claim was stale). What's genuinely missing is a
-- POST-due-date escalating chase for patients who blew past their date
-- entirely, plus a channel distinction (Call vs WhatsApp) neither table
-- had before -- every row currently gets an automated WhatsApp regardless
-- of its label, with Call vs WhatsApp only a manual-worklist convention.
--
-- Also found and fixed live (separate from this migration, via direct SQL
-- during this session): followup_touchpoints had 16 exact duplicate rows
-- (32 total) -- every patient was getting each pre-due reminder TWICE.
-- Deduped before this migration ran.
-- ============================================================================

BEGIN;

ALTER TABLE followup_touchpoints ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'WHATSAPP';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'followup_touchpoints_channel_check'
  ) THEN
    ALTER TABLE followup_touchpoints
      ADD CONSTRAINT followup_touchpoints_channel_check CHECK (channel IN ('CALL', 'WHATSAPP'));
  END IF;
END $$;

ALTER TABLE followups ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'WHATSAPP';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'followups_channel_check'
  ) THEN
    ALTER TABLE followups
      ADD CONSTRAINT followups_channel_check CHECK (channel IN ('CALL', 'WHATSAPP'));
  END IF;
END $$;

-- Seed the locked 7-stage cadence -- min_gap_days=0/max_gap_days=999999
-- matches every visit regardless of its own gap bracket (additive to the
-- existing pre-due tiers, not a replacement for them), and negative
-- days_before_due means "this many days AFTER the due date" (generateFollowupSchedule
-- in db.ts already clamps anything landing before today, so a large
-- negative offset on a near-future due date safely does nothing until
-- that date actually passes). Guarded so re-running this file, or a
-- second session, never inserts it twice.
INSERT INTO followup_touchpoints (label, min_gap_days, max_gap_days, days_before_due, channel, active)
SELECT * FROM (VALUES
  ('Day 0 Call', 0, 999999, 0, 'CALL', true),
  ('Day 2 WhatsApp', 0, 999999, -2, 'WHATSAPP', true),
  ('Day 5 Call', 0, 999999, -5, 'CALL', true),
  ('Day 9 WhatsApp', 0, 999999, -9, 'WHATSAPP', true),
  ('Day 14 Call', 0, 999999, -14, 'CALL', true),
  ('Day 19 WhatsApp', 0, 999999, -19, 'WHATSAPP', true),
  ('Day 25 Call (final)', 0, 999999, -25, 'CALL', true)
) AS seed(label, min_gap_days, max_gap_days, days_before_due, channel, active)
WHERE NOT EXISTS (SELECT 1 FROM followup_touchpoints WHERE label = 'Day 0 Call');

-- reschedule_followups_atomic (0024) needs to accept + store channel now.
-- Same signature otherwise, same visit-row-lock pattern.
CREATE OR REPLACE FUNCTION reschedule_followups_atomic(
  p_patient_id uuid,
  p_visit_id uuid,
  p_rows jsonb
) RETURNS void AS $$
DECLARE
  v_visit_exists uuid;
BEGIN
  SELECT id INTO v_visit_exists FROM visits WHERE id = p_visit_id FOR UPDATE;
  IF v_visit_exists IS NULL THEN
    RAISE EXCEPTION 'Visit not found: %', p_visit_id;
  END IF;

  DELETE FROM followups
  WHERE visit_id = p_visit_id
    AND status = 'PENDING';

  INSERT INTO followups (patient_id, visit_id, due_date, followup_type, channel, status)
  SELECT
    p_patient_id,
    p_visit_id,
    (r->>'due_date')::date,
    r->>'followup_type',
    coalesce(r->>'channel', 'WHATSAPP'),
    'PENDING'
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMIT;
