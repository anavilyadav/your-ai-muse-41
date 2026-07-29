-- ============================================================================
-- YHC-OS — Payment Adjustments (Overpayment Ledger) — Audit P0-6
-- Run this ONCE in Supabase SQL Editor. Safe to re-run (uses IF NOT EXISTS /
-- CREATE OR REPLACE / DROP-then-CREATE for the trigger).
--
-- ASSUMPTION FLAGGED: patients.id / visits.id / payments.id are assumed to be
-- `uuid` (matches the rest of the schema's pattern). If your payments/visits/
-- patients primary keys are NOT uuid, change the column types below before
-- running. I could not read the live schema directly (no DB credentials in
-- this session) — please eyeball this before running, same as any SQL you'd
-- get from any other session.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payment_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  source_payment_id uuid REFERENCES payments(id),
  visit_id uuid REFERENCES visits(id),
  branch text,
  amount numeric NOT NULL CHECK (amount > 0),
  type text NOT NULL DEFAULT 'OVERPAYMENT',
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | REFUNDED | CREDIT_AVAILABLE | APPLIED
  resolution_method text,                  -- REFUND | CREDIT_NOTE
  resolved_by text,
  resolved_at timestamptz,
  applied_to_visit_id uuid REFERENCES visits(id),
  applied_amount numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_adjustments_patient ON payment_adjustments(patient_id);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_status ON payment_adjustments(status);

-- ---------------------------------------------------------------------------
-- Trigger: auto-detect overpayment on EVERY payments insert, regardless of
-- which function/RPC/code-path did the insert. This is the fix for P0-6 —
-- previously overpayment (amount_received > amount_charged) just silently
-- clamped balance_due to 0 with no trace of the extra money.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_detect_overpayment() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_received > NEW.amount_charged THEN
    INSERT INTO payment_adjustments (patient_id, source_payment_id, visit_id, branch, amount, type, status)
    VALUES (NEW.patient_id, NEW.id, NEW.visit_id, NEW.branch, NEW.amount_received - NEW.amount_charged, 'OVERPAYMENT', 'PENDING');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_detect_overpayment ON payments;
CREATE TRIGGER trg_detect_overpayment
AFTER INSERT ON payments
FOR EACH ROW EXECUTE FUNCTION fn_detect_overpayment();

-- ---------------------------------------------------------------------------
-- Owner resolves a PENDING adjustment: REFUND (closed, cash handed back
-- outside the system) or CREDIT_NOTE (becomes spendable credit for the
-- patient's next visit).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_payment_adjustment(
  p_adjustment_id uuid,
  p_method text,
  p_resolved_by text,
  p_notes text DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_row payment_adjustments%ROWTYPE;
BEGIN
  IF p_method NOT IN ('REFUND', 'CREDIT_NOTE') THEN
    RAISE EXCEPTION 'invalid method: %', p_method;
  END IF;

  SELECT * INTO v_row FROM payment_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjustment not found';
  END IF;
  IF v_row.status <> 'PENDING' THEN
    RAISE EXCEPTION 'adjustment already resolved (status=%)', v_row.status;
  END IF;

  UPDATE payment_adjustments
  SET status = CASE WHEN p_method = 'REFUND' THEN 'REFUNDED' ELSE 'CREDIT_AVAILABLE' END,
      resolution_method = p_method,
      resolved_by = p_resolved_by,
      resolved_at = now(),
      notes = COALESCE(p_notes, notes)
  WHERE id = p_adjustment_id;

  RETURN json_build_object('success', true, 'status', CASE WHEN p_method = 'REFUND' THEN 'REFUNDED' ELSE 'CREDIT_AVAILABLE' END);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Apply available credit (oldest-first) to a visit, atomically, up to
-- p_requested_amount. Row-locks the patient's CREDIT_AVAILABLE rows so two
-- staff cannot spend the same credit twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_available_credit(
  p_patient_id uuid,
  p_visit_id uuid,
  p_requested_amount numeric
) RETURNS json AS $$
DECLARE
  v_remaining numeric := p_requested_amount;
  v_applied numeric := 0;
  r payment_adjustments%ROWTYPE;
BEGIN
  IF p_requested_amount <= 0 THEN
    RETURN json_build_object('applied', 0);
  END IF;

  FOR r IN
    SELECT * FROM payment_adjustments
    WHERE patient_id = p_patient_id AND status = 'CREDIT_AVAILABLE'
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF r.amount <= v_remaining THEN
      UPDATE payment_adjustments
      SET status = 'APPLIED', applied_to_visit_id = p_visit_id, applied_amount = r.amount
      WHERE id = r.id;
      v_applied := v_applied + r.amount;
      v_remaining := v_remaining - r.amount;
    ELSE
      -- Partial consume: shrink this row's remaining balance, and log the
      -- applied slice as its own APPLIED row for a clean audit trail.
      UPDATE payment_adjustments SET amount = r.amount - v_remaining WHERE id = r.id;
      INSERT INTO payment_adjustments
        (patient_id, source_payment_id, visit_id, branch, amount, type, status, resolution_method, resolved_by, resolved_at, applied_to_visit_id, applied_amount, notes)
      VALUES
        (r.patient_id, r.source_payment_id, r.visit_id, r.branch, v_remaining, r.type, 'APPLIED', r.resolution_method, r.resolved_by, now(), p_visit_id, v_remaining, r.notes);
      v_applied := v_applied + v_remaining;
      v_remaining := 0;
    END IF;
  END LOOP;

  RETURN json_build_object('applied', v_applied);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Compensating action: if the payment insert fails AFTER credit was applied,
-- the app calls this to give the credit back. Matches the existing
-- best-effort/surface-the-failure pattern already used for follow-up
-- scheduling elsewhere in this codebase.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revert_credit_application(p_visit_id uuid) RETURNS json AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE payment_adjustments
  SET status = 'CREDIT_AVAILABLE', applied_to_visit_id = NULL, applied_amount = NULL
  WHERE applied_to_visit_id = p_visit_id AND status = 'APPLIED';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('reverted_rows', v_count);
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after the above):
-- ---------------------------------------------------------------------------
-- select * from payment_adjustments order by created_at desc limit 10;
-- select routine_name from information_schema.routines
--   where routine_name in ('resolve_payment_adjustment','apply_available_credit','revert_credit_application');
