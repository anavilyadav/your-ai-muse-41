-- ============================================================================
-- YHC-OS — Phase 1 item #1: move credit apply/revert INSIDE collect_payment_atomic
--
-- PROBLEM: credit apply (apply_available_credit) and payment insert
-- (collect_payment_atomic) were two separate RPC calls from the client.
-- If the payment call failed AFTER credit was applied, the client had to
-- remember to call revert_credit_application — a best-effort, easy-to-miss
-- compensating step. If the browser closed / network died between the two
-- calls, credit was left stuck as APPLIED against a payment that never
-- happened, with no automatic recovery.
--
-- FIX: collect_payment_atomic now accepts an optional p_credit_to_apply
-- and consumes the patient's CREDIT_AVAILABLE rows itself, inside the SAME
-- transaction as the payment insert. If anything fails, Postgres rolls back
-- everything — payment AND credit consumption together. No revert call is
-- needed anymore because there is no window where one succeeded and the
-- other didn't.
--
-- Safe to re-run (CREATE OR REPLACE). p_credit_to_apply defaults to 0, so
-- any caller still using the old 7-argument signature behaves identically
-- to before.
--
-- apply_available_credit / revert_credit_application (from migration 0004)
-- are left in place (harmless, no longer called by the app) in case a
-- rollback to the old flow is ever needed.
-- ============================================================================

create or replace function collect_payment_atomic(
  p_visit_id uuid,
  p_patient_id uuid,
  p_amount_charged numeric,
  p_amount_received numeric,
  p_payment_mode text,
  p_branch text,
  p_notes text default null,
  p_credit_to_apply numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
begin
  select visit_status, next_visit_date
    into v_visit_status, v_next_visit_date
  from visits
  where id = p_visit_id
  for update;

  if v_visit_status is null then
    raise exception 'Visit not found';
  end if;

  if v_visit_status = 'DONE' then
    raise exception 'Yeh visit already DONE hai — dobara payment collect nahi kar sakte. Correction chahiye toh Owner se refund/adjustment karwao.';
  end if;

  -- Consume credit (oldest-first), row-locked, inside this same
  -- transaction — two staff still can't spend the same credit twice
  -- (FOR UPDATE), and there's no longer a gap between "credit applied"
  -- and "payment recorded" for anything to get stuck in.
  if p_credit_to_apply > 0 then
    v_credit_remaining := p_credit_to_apply;
    for r in
      select * from payment_adjustments
      where patient_id = p_patient_id and status = 'CREDIT_AVAILABLE'
      order by created_at asc
      for update
    loop
      exit when v_credit_remaining <= 0;
      if r.amount <= v_credit_remaining then
        update payment_adjustments
        set status = 'APPLIED', applied_to_visit_id = p_visit_id, applied_amount = r.amount
        where id = r.id;
        v_credit_applied := v_credit_applied + r.amount;
        v_credit_remaining := v_credit_remaining - r.amount;
      else
        -- Partial consume: shrink this row's remaining balance, log the
        -- applied slice as its own APPLIED row for a clean audit trail
        -- (same pattern as the old apply_available_credit).
        update payment_adjustments set amount = r.amount - v_credit_remaining where id = r.id;
        insert into payment_adjustments
          (patient_id, source_payment_id, visit_id, branch, amount, type, status, resolution_method, resolved_by, resolved_at, applied_to_visit_id, applied_amount, notes)
        values
          (r.patient_id, r.source_payment_id, r.visit_id, r.branch, v_credit_remaining, r.type, 'APPLIED', r.resolution_method, r.resolved_by, now(), p_visit_id, v_credit_remaining, r.notes);
        v_credit_applied := v_credit_applied + v_credit_remaining;
        v_credit_remaining := 0;
      end if;
    end loop;
  end if;

  v_total_received := p_amount_received + v_credit_applied;
  v_balance := greatest(0, p_amount_charged - v_total_received);

  v_notes := p_notes;
  if v_credit_applied > 0 then
    v_notes := coalesce(p_notes || ' | ', '') || 'Includes ₹' || v_credit_applied || ' credit note applied';
  end if;

  insert into payments (
    visit_id, patient_id, amount_charged, amount_received,
    balance_due, payment_mode, branch, notes
  ) values (
    p_visit_id, p_patient_id, p_amount_charged, v_total_received,
    v_balance, p_payment_mode, p_branch, v_notes
  )
  returning id into v_payment_id;

  perform 1 from patients where id = p_patient_id for update;

  select coalesce(sum(balance_due), 0)
    into v_new_current_balance
  from payments
  where patient_id = p_patient_id;

  update patients
  set lifetime_revenue = coalesce(lifetime_revenue, 0) + v_total_received,
      current_balance = v_new_current_balance
  where id = p_patient_id;

  if v_balance = 0 then
    update visits set visit_status = 'DONE' where id = p_visit_id;
  else
    update visits set visit_status = 'PAYMENT' where id = p_visit_id;
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'balance', v_balance,
    'visit_status', case when v_balance = 0 then 'DONE' else 'PAYMENT' end,
    'next_visit_date', v_next_visit_date,
    'credit_applied', v_credit_applied
  );
end;
$$;

-- ============================================================================
-- VERIFY — should show the function with 8 args now
-- ============================================================================
select proname, pronargs from pg_proc where proname = 'collect_payment_atomic';
