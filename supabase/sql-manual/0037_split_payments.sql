-- ============================================================================
-- YHC-OS — Split payments (multiple modes per collection) — 10 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (IF NOT EXISTS / CREATE OR REPLACE throughout).
--
-- WHY
-- Reception could only record ONE payment mode per collection — a patient
-- paying ₹2000 cash + ₹1000 Paytm in the same visit had no way to be
-- recorded accurately. Dr. Yadav's decisions (10 Aug 2026): split amounts
-- must sum exactly to the amount collected (no partial/rounding slack),
-- and new payment modes Owner adds must show as their own line in
-- reports/dashboards, not lumped into "Other".
--
-- payment_modes: Owner-managed list of modes. CASH/UPI/CARD seeded as
-- is_system=true (protected from deletion — deeply embedded in existing
-- reporting/CSV-import code as literal strings) but can still be
-- deactivated if truly unused. Owner can add new ones (e.g. PAYTM) freely.
--
-- payment_splits: one row per (payment, mode). Every payment gets at least
-- one split row — single-mode payments too — so every report can read
-- breakdown-by-mode uniformly from this one table instead of half reading
-- payments.payment_mode and half something else.
-- ============================================================================

create table if not exists public.payment_modes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_active boolean not null default true,
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.payment_modes (code, label, is_system, sort_order)
values
  ('CASH', 'Cash', true, 1),
  ('UPI', 'UPI', true, 2),
  ('CARD', 'Card', true, 3)
on conflict (code) do nothing;

create table if not exists public.payment_splits (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  mode text not null,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_splits_payment_id on public.payment_splits(payment_id);
create index if not exists idx_payment_splits_mode on public.payment_splits(mode);

-- Backfill: every historical payment gets exactly one split row matching
-- its existing single payment_mode, so reports reading from payment_splits
-- see the whole history, not just splits collected after this migration.
insert into public.payment_splits (payment_id, mode, amount)
select p.id, p.payment_mode, p.amount_received
from public.payments p
where p.amount_received > 0
  and not exists (select 1 from public.payment_splits ps where ps.payment_id = p.id);

-- ---------------------------------------------------------------------------
-- collect_payment_atomic: adds an optional p_splits jsonb param (array of
-- {"mode": "CASH", "amount": 2000} objects). When provided, validated to
-- sum exactly to p_amount_received and inserted as one payment_splits row
-- per entry, in the same transaction as the payment itself. When omitted
-- (old callers, or a single-mode payment), falls back to one split row
-- using p_payment_mode/p_amount_received — same trailing-default pattern
-- already used for p_credit_to_apply and p_idempotency_key.
-- ---------------------------------------------------------------------------
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

  -- Splits must sum exactly to what reception actually collected (not
  -- including credit applied — credit isn't a physical payment mode).
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
$function$;

-- ---------------------------------------------------------------------------
-- CRITICAL CLEANUP — do not skip this part.
--
-- The CREATE OR REPLACE above did NOT replace the existing 9-arg function.
-- Postgres identifies a function by name + parameter TYPE LIST; adding a
-- 10th parameter (even with a default) makes it a distinct signature, so
-- this created a SECOND overload and left the original 9-arg one in place
-- untouched (confirmed live, 10 Aug 2026 — same duplicate-overload class
-- of bug migration 0017 hit before). Worse: brand-new Postgres functions
-- get EXECUTE granted to PUBLIC by default, which anon inherits — so this
-- one command silently reopened the exact C-2 hole (anon-executable
-- payment RPC) the 5 Aug zero-trust audit fixed. Both steps below are
-- required, not optional, whenever a trailing parameter is added to any
-- previously-hardened SECURITY DEFINER function.
-- ---------------------------------------------------------------------------
drop function if exists public.collect_payment_atomic(
  uuid, uuid, numeric, numeric, text, text, text, numeric, text
);

revoke execute on function public.collect_payment_atomic(
  uuid, uuid, numeric, numeric, text, text, text, numeric, text, jsonb
) from public, anon;

grant execute on function public.collect_payment_atomic(
  uuid, uuid, numeric, numeric, text, text, text, numeric, text, jsonb
) to authenticated;
