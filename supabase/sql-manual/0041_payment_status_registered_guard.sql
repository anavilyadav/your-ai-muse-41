-- ============================================================================
-- YHC-OS — Fix: inline payment-at-registration marked visits DONE before the
-- doctor ever saw the patient (13 Aug 2026)
--
-- collect_payment_atomic (unchanged signature) always assumed payment is
-- the LAST action of a visit -- a full payment sets visit_status = 'DONE',
-- a partial one sets it to 'PAYMENT'. That was true for every existing
-- caller (the Pay screen, reached after case-taking/Rx are already done).
--
-- The new inline payment step on the registration form calls this exact
-- same RPC immediately after the visit is created, while visit_status is
-- still 'REGISTERED' -- the doctor hasn't seen the patient yet. A full
-- payment there was flipping the visit straight to 'DONE', which isn't in
-- the doctor's queue filter (REGISTERED/CASE_TAKING/WAITING_DOCTOR), so the
-- case vanished before the clinical workflow even started.
--
-- Fix: only let this RPC advance visit_status when the visit has already
-- left 'REGISTERED' (i.e. clinical work is actually underway or done).
-- Every existing call site is unaffected -- none of them ever call this
-- while a visit is still 'REGISTERED', so this only changes behavior for
-- the new case that didn't exist before today.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.collect_payment_atomic(
  p_visit_id uuid,
  p_patient_id uuid,
  p_amount_charged numeric,
  p_amount_received numeric,
  p_payment_mode text,
  p_branch text,
  p_notes text DEFAULT NULL::text,
  p_credit_to_apply numeric DEFAULT 0,
  p_idempotency_key text DEFAULT NULL::text,
  p_splits jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_splits_sum numeric;
  v_final_visit_status text;
BEGIN
  SELECT visit_status, next_visit_date
    INTO v_visit_status, v_next_visit_date
  FROM visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF v_visit_status IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;

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

  IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
    SELECT coalesce(sum((elem->>'amount')::numeric), 0)
      INTO v_splits_sum
    FROM jsonb_array_elements(p_splits) elem;

    IF v_splits_sum <> p_amount_received THEN
      RAISE EXCEPTION 'Split amounts (₹%) collected amount (₹%) se match nahi karte', v_splits_sum, p_amount_received;
    END IF;
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

  IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
    INSERT INTO payment_splits (payment_id, mode, amount)
    SELECT v_payment_id, elem->>'mode', (elem->>'amount')::numeric
    FROM jsonb_array_elements(p_splits) elem;
  ELSIF p_amount_received > 0 THEN
    INSERT INTO payment_splits (payment_id, mode, amount)
    VALUES (v_payment_id, p_payment_mode, p_amount_received);
  END IF;

  PERFORM 1 FROM patients WHERE id = p_patient_id FOR UPDATE;

  SELECT coalesce(sum(balance_due), 0)
    INTO v_new_current_balance
  FROM payments
  WHERE patient_id = p_patient_id;

  UPDATE patients
  SET lifetime_revenue = coalesce(lifetime_revenue, 0) + v_total_received,
      current_balance = v_new_current_balance
  WHERE id = p_patient_id;

  -- Payment collected while the visit is still REGISTERED means the
  -- doctor hasn't seen this patient yet (the new inline-at-registration
  -- case) -- leave visit_status untouched so it still shows up in the
  -- clinical queue, instead of skipping straight to DONE/PAYMENT and
  -- disappearing before the case has even started.
  IF v_visit_status <> 'REGISTERED' THEN
    IF v_balance = 0 THEN
      UPDATE visits SET visit_status = 'DONE' WHERE id = p_visit_id;
    ELSE
      UPDATE visits SET visit_status = 'PAYMENT' WHERE id = p_visit_id;
    END IF;
  END IF;

  SELECT visit_status INTO v_final_visit_status FROM visits WHERE id = p_visit_id;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'balance', v_balance,
    'visit_status', v_final_visit_status,
    'next_visit_date', v_next_visit_date,
    'credit_applied', v_credit_applied
  );
END;
$function$;
