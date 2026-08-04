-- ============================================================================
-- YHC-OS — Payment idempotency key — 04 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (CREATE OR REPLACE / IF NOT EXISTS throughout).
--
-- Problem being solved (Part 3 pending item, carried from the 30 Jul audit):
-- collect_payment_atomic() has no protection against being called twice for
-- the same logical submission. For a FULL payment this is partially masked
-- by accident -- the visit flips to DONE, and the existing DONE guard
-- rejects a second call. But for a PARTIAL payment the visit stays in
-- 'PAYMENT' status, which the DONE guard doesn't block -- so clinic wifi
-- timing out mid-request, staff re-tapping Submit, or a slow network
-- causing a manual retry can insert a second payment row for money that
-- was only actually handed over once. That means lifetime_revenue and
-- current_balance both get inflated by the duplicate.
--
-- Fix: payments gets a nullable, uniquely-indexed idempotency_key column.
-- The client generates one key per payment-screen visit (src/routes/
-- pay.$id.tsx, one per page mount, reused across retries of that same
-- click) and passes it through. collect_payment_atomic() checks for an
-- existing row with that key -- AFTER acquiring the visit's FOR UPDATE
-- lock, so a genuinely concurrent double-tap is serialized rather than
-- racing -- and returns the original result instead of inserting again.
-- ============================================================================

BEGIN;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial index: only enforces uniqueness where a key was actually
-- supplied. Old rows (and any future caller that doesn't pass one) keep
-- their idempotency_key NULL and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx
  ON payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Discovered when actually applying this live (04 Aug 2026): CREATE OR
-- REPLACE FUNCTION does NOT replace a function whose argument COUNT
-- differs, even when the new arg is a trailing DEFAULT -- it silently
-- creates a second overload instead. Same bug class that migration 0017
-- had to hotfix for the 7-arg -> 8-arg change. Drop the old 8-arg
-- signature explicitly before creating the 9-arg one below, or the app
-- ends up with two ambiguous overloads and every payment call breaks.
DROP FUNCTION IF EXISTS collect_payment_atomic(uuid, uuid, numeric, numeric, text, text, text, numeric);

CREATE OR REPLACE FUNCTION collect_payment_atomic(
  p_visit_id uuid,
  p_patient_id uuid,
  p_amount_charged numeric,
  p_amount_received numeric,
  p_payment_mode text,
  p_branch text,
  p_notes text DEFAULT NULL,
  p_credit_to_apply numeric DEFAULT 0,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit_status text;
  v_next_visit_date date;
  v_balance numeric;
  v_new_current_balance numeric;
  v_payment_id uuid;
  v_credit_applied numeric := 0;
  v_credit_remaining numeric;
  v_total_received numeric;
  v_notes text;
  r payment_adjustments%rowtype;
  v_existing record;
BEGIN
  SELECT visit_status, next_visit_date
    INTO v_visit_status, v_next_visit_date
  FROM visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF v_visit_status IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;

  -- Idempotency check -- deliberately AFTER the visit lock above, so a
  -- genuinely simultaneous duplicate call (not just a sequential retry)
  -- queues on that lock and only proceeds once the first call has
  -- committed its row, at which point this SELECT will actually find it.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT p.id AS payment_id, p.balance_due, v.visit_status, v.next_visit_date
      INTO v_existing
    FROM payments p
    JOIN visits v ON v.id = p.visit_id
    WHERE p.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'payment_id', v_existing.payment_id,
        'balance', v_existing.balance_due,
        'visit_status', v_existing.visit_status,
        'next_visit_date', v_existing.next_visit_date,
        'credit_applied', 0,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  IF v_visit_status = 'DONE' THEN
    RAISE EXCEPTION 'Yeh visit already DONE hai — dobara payment collect nahi kar sakte. Correction chahiye toh Owner se refund/adjustment karwao.';
  END IF;

  IF p_credit_to_apply > 0 THEN
    v_credit_remaining := p_credit_to_apply;
    FOR r IN
      SELECT * FROM payment_adjustments
      WHERE patient_id = p_patient_id AND status = 'CREDIT_AVAILABLE'
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_credit_remaining <= 0;
      IF r.amount <= v_credit_remaining THEN
        UPDATE payment_adjustments
        SET status = 'APPLIED', applied_to_visit_id = p_visit_id, applied_amount = r.amount
        WHERE id = r.id;
        v_credit_applied := v_credit_applied + r.amount;
        v_credit_remaining := v_credit_remaining - r.amount;
      ELSE
        UPDATE payment_adjustments SET amount = r.amount - v_credit_remaining WHERE id = r.id;
        INSERT INTO payment_adjustments
          (patient_id, source_payment_id, visit_id, branch, amount, type, status, resolution_method, resolved_by, resolved_at, applied_to_visit_id, applied_amount, notes)
        VALUES
          (r.patient_id, r.source_payment_id, r.visit_id, r.branch, v_credit_remaining, r.type, 'APPLIED', r.resolution_method, r.resolved_by, now(), p_visit_id, v_credit_remaining, r.notes);
        v_credit_applied := v_credit_applied + v_credit_remaining;
        v_credit_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  v_total_received := p_amount_received + v_credit_applied;
  v_balance := greatest(0, p_amount_charged - v_total_received);

  v_notes := p_notes;
  IF v_credit_applied > 0 THEN
    v_notes := coalesce(p_notes || ' | ', '') || 'Includes ₹' || v_credit_applied || ' credit note applied';
  END IF;

  INSERT INTO payments (
    visit_id, patient_id, amount_charged, amount_received,
    balance_due, payment_mode, branch, notes, idempotency_key
  ) VALUES (
    p_visit_id, p_patient_id, p_amount_charged, v_total_received,
    v_balance, p_payment_mode, p_branch, v_notes, p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  PERFORM 1 FROM patients WHERE id = p_patient_id FOR UPDATE;

  SELECT coalesce(sum(balance_due), 0)
    INTO v_new_current_balance
  FROM payments
  WHERE patient_id = p_patient_id;

  UPDATE patients
  SET lifetime_revenue = coalesce(lifetime_revenue, 0) + v_total_received,
      current_balance = v_new_current_balance
  WHERE id = p_patient_id;

  IF v_balance = 0 THEN
    UPDATE visits SET visit_status = 'DONE' WHERE id = p_visit_id;
  ELSE
    UPDATE visits SET visit_status = 'PAYMENT' WHERE id = p_visit_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'balance', v_balance,
    'visit_status', CASE WHEN v_balance = 0 THEN 'DONE' ELSE 'PAYMENT' END,
    'next_visit_date', v_next_visit_date,
    'credit_applied', v_credit_applied
  );
END;
$$;

-- ============================================================================
-- VERIFY — should show the function with 9 args now
-- ============================================================================
SELECT proname, pronargs FROM pg_proc WHERE proname = 'collect_payment_atomic';

COMMIT;
