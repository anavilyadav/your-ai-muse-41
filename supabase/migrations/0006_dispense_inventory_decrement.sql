-- ============================================================================
-- YHC-OS — Atomic Dispense + Inventory Decrement — Audit P0-5
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- Dr. Yadav's decision (29 Jul 2026): 45ml bottle = 4 drams.
-- is_slx (SL globules, ON by default) dispense = 4 drams (full bottle).
-- non-SLX (drops/liquid) dispense = 0.5 dram.
-- Deliberately approximate -- staff already tracks the physical bottle;
-- this is a reconcilable estimate, not a precise metered count.
--
-- If no inventory row exists yet for a medicine+potency+branch (not
-- stocked/tracked), that line is skipped -- never blocks dispensing.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION dispense_visit_atomic(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit_status text;
  v_branch text;
  r record;
  v_decremented jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  SELECT visit_status, branch INTO v_visit_status, v_branch
  FROM visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF v_visit_status IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;

  IF v_visit_status <> 'PHARMACY' THEN
    RAISE EXCEPTION 'Yeh visit abhi Pharmacy stage mein nahi hai — dispense nahi kar sakte.';
  END IF;

  UPDATE visits SET visit_status = 'PAYMENT' WHERE id = p_visit_id;

  FOR r IN
    SELECT medicine_name, potency, is_slx
    FROM prescriptions
    WHERE visit_id = p_visit_id
  LOOP
    DECLARE
      v_amount numeric := CASE WHEN r.is_slx THEN 4 ELSE 0.5 END;
      v_inv_id uuid;
    BEGIN
      SELECT id INTO v_inv_id
      FROM inventory
      WHERE medicine_name = r.medicine_name
        AND potency IS NOT DISTINCT FROM r.potency
        AND branch = v_branch
      FOR UPDATE;

      IF v_inv_id IS NULL THEN
        v_skipped := v_skipped || jsonb_build_object('medicine_name', r.medicine_name, 'potency', r.potency);
      ELSE
        UPDATE inventory SET stock_drams = COALESCE(stock_drams, 0) - v_amount WHERE id = v_inv_id;
        v_decremented := v_decremented || jsonb_build_object('medicine_name', r.medicine_name, 'potency', r.potency, 'drams', v_amount);
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'visit_id', p_visit_id,
    'decremented', v_decremented,
    'skipped_not_in_inventory', v_skipped
  );
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFY
-- ============================================================================
-- select proname from pg_proc where proname = 'dispense_visit_atomic';
--
-- ROLLBACK (only if needed):
-- drop function if exists dispense_visit_atomic(uuid);
