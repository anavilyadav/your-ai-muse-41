-- ============================================================================
-- YHC-OS — Atomic Daily Token Counter — Re-audit finding (29 Jul 2026)
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- nextTokenForToday was still using the same racy count()+1 pattern that
-- patient_code had before it was fixed (audit P0-3). Two simultaneous
-- registrations at the same branch could compute the same token.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS daily_token_counters (
  branch text NOT NULL,
  token_date date NOT NULL,
  last_token int NOT NULL DEFAULT 0,
  PRIMARY KEY (branch, token_date)
);

CREATE OR REPLACE FUNCTION next_token_for_day(p_branch text, p_date date) RETURNS text AS $$
DECLARE
  v_n int;
BEGIN
  INSERT INTO daily_token_counters (branch, token_date, last_token)
  VALUES (p_branch, p_date, 1)
  ON CONFLICT (branch, token_date) DO UPDATE SET last_token = daily_token_counters.last_token + 1
  RETURNING last_token INTO v_n;
  RETURN 'T-' || lpad(v_n::text, 2, '0');
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- VERIFY:
-- select next_token_for_day('BAJAJ_NAGAR', current_date);
-- select next_token_for_day('BAJAJ_NAGAR', current_date); -- should be T-02, not T-01 again
