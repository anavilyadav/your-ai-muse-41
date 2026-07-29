-- ============================================================================
-- YHC-OS — 29 Jul 2026 session — COMBINED SQL (2 RPCs, safe to run together)
-- Paste this WHOLE file into Supabase → SQL Editor → New query → Run.
-- Both are CREATE OR REPLACE — safe to re-run if you're not sure whether
-- you already ran them.
-- ============================================================================


-- ============================================================================
-- PART 1 — Atomic Payment Collection RPC (fixes audit P0 #1, #2, #4, #7)
--
-- collectPayment was 4 separate client calls (insert payment, read patient,
-- update patient, update visit) — a crash mid-sequence left the payment
-- committed but patient/visit stale. Now all of it runs inside ONE Postgres
-- function = one transaction, all-or-nothing. Also fixes: current_balance
-- now always = SUM(payments.balance_due) for the patient (was two
-- conflicting formulas in two code paths); patient + visit rows locked
-- FOR UPDATE, closing the read-modify-write race; DONE-guard now inside the
-- same locked transaction as the status update.
-- ============================================================================

create or replace function collect_payment_atomic(
  p_visit_id uuid,
  p_patient_id uuid,
  p_amount_charged numeric,
  p_amount_received numeric,
  p_payment_mode text,
  p_branch text,
  p_notes text default null
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

  v_balance := greatest(0, p_amount_charged - p_amount_received);

  insert into payments (
    visit_id, patient_id, amount_charged, amount_received,
    balance_due, payment_mode, branch, notes
  ) values (
    p_visit_id, p_patient_id, p_amount_charged, p_amount_received,
    v_balance, p_payment_mode, p_branch, p_notes
  )
  returning id into v_payment_id;

  perform 1 from patients where id = p_patient_id for update;

  select coalesce(sum(balance_due), 0)
    into v_new_current_balance
  from payments
  where patient_id = p_patient_id;

  update patients
  set lifetime_revenue = coalesce(lifetime_revenue, 0) + p_amount_received,
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
    'next_visit_date', v_next_visit_date
  );
end;
$$;


-- ============================================================================
-- PART 2 — Atomic returning-patient check-in RPC (fixes audit P0 #3, live path)
--
-- checkInExistingPatient generated token_number with a plain client-side
-- count()+1 — two simultaneous check-ins at the same branch could compute
-- the same T-XX token. Token generation now happens under a transaction-
-- scoped advisory lock keyed on (branch, date).
-- ============================================================================

create or replace function check_in_existing_patient_atomic(
  p_patient_id uuid,
  p_branch text,
  p_chief_complaint text default null,
  p_visit_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_n int;
  v_visit_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_branch || p_visit_date::text));

  select count(*) into v_n from visits where visit_date = p_visit_date and branch = p_branch;
  v_token := 'T-' || lpad((v_n + 1)::text, 2, '0');

  insert into visits (patient_id, visit_date, visit_type, visit_status, token_number, branch, chief_complaint)
  values (p_patient_id, p_visit_date, 'OPD', 'REGISTERED', v_token, p_branch, p_chief_complaint)
  returning id into v_visit_id;

  update patients
  set lifetime_visits = coalesce(lifetime_visits, 0) + 1
  where id = p_patient_id;

  update followups set status = 'DONE' where patient_id = p_patient_id and status = 'PENDING';

  return (select to_jsonb(v) from (select * from visits where id = v_visit_id) v);
end;
$$;


-- ============================================================================
-- VERIFY — both functions should show up here after running the above
-- ============================================================================
select proname from pg_proc where proname in ('collect_payment_atomic', 'check_in_existing_patient_atomic');


-- ============================================================================
-- ROLLBACK — only if needed (uncomment and run individually)
-- ============================================================================
-- drop function if exists collect_payment_atomic(uuid, uuid, numeric, numeric, text, text, text);
-- drop function if exists check_in_existing_patient_atomic(uuid, text, text, date);
