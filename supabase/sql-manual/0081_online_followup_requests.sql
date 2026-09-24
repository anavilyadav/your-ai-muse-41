-- 0081 — Online Follow-up requests: payment BEFORE the doctor ever sees it
-- (25 Sep 2026, Dr. Yadav's Reception-flow redesign)
--
-- Today an online follow-up check-in (register.tsx's "🎥 Online Follow-up"
-- button on an existing patient) takes no note of what the patient wants,
-- creates a real doctor-queue token immediately with NO payment gate, and
-- prefills the wrong price (feeKindForVisit buckets every VIDEO visit as
-- the flat new-patient bundle fee, online-new and online-follow-up alike).
--
-- Dr. Yadav's spec: for an ONLINE FOLLOW-UP call (never for a walk-in —
-- walk-ins still pay in person after arriving, untouched by this), payment
-- must be collected and a screenshot uploaded BEFORE anything reaches the
-- doctor. Until then it's a "rough"/provisional entry Reception and Owner
-- can both see. The follow-up should count on the day payment lands, not
-- the day the patient called.
--
-- Rather than teaching 4 separate report functions (fetchDaySummary,
-- owner_totals, week_revenue, report_totals — all keyed on visits.visit_date
-- since the 0066 bulk-import date bug fix) about a new provisional visit
-- status, this table holds the request BEFORE any visit exists at all. No
-- visits row, no token, invisible to every doctor queue — until
-- confirm_online_followup_request_atomic() below creates the visit (dated
-- TODAY, at confirm time) in the same transaction as the payment. The
-- existing date-keyed counts land on the right day for free.

create table if not exists public.online_followup_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  branch text not null,
  note text not null,                    -- kya chahiye, staff ne kya samjha
  days_requested integer,                -- kitne din ki dawa — informational only, doesn't drive price
  delivery_method text not null check (delivery_method in ('SELF_PICKUP','JAIPUR_COURIER','COURIER')),
  delivery_address_id uuid references public.patient_addresses(id),
  delivery_address_text text,            -- resolved address snapshot at request time, used verbatim at confirm
  amount_expected numeric not null,      -- prefilled from settings key online_followup_pricing, editable
  status text not null default 'AWAITING_PAYMENT' check (status in ('AWAITING_PAYMENT','CONFIRMED','CANCELLED')),
  payment_screenshot_doc_id uuid references public.patient_documents(id),
  amount_confirmed numeric,
  visit_id uuid references public.visits(id),
  delivery_id uuid references public.deliveries(id),
  created_by text,
  created_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz
);

create index if not exists online_followup_requests_status_idx on public.online_followup_requests (status);
create index if not exists online_followup_requests_patient_id_idx on public.online_followup_requests (patient_id);

-- RLS Phase 1 pattern (see 0043_rls_core_phase1.sql, and 0080 for the most
-- recent copy of this exact block) — close anon off entirely, full CRUD
-- for any signed-in staff member.
alter table public.online_followup_requests enable row level security;

revoke all on public.online_followup_requests from public, anon;
grant select, insert, update, delete on public.online_followup_requests to authenticated;

drop policy if exists online_followup_requests_staff_all on public.online_followup_requests;
create policy online_followup_requests_staff_all on public.online_followup_requests for all to authenticated using (true) with check (true);

drop trigger if exists trg_audit_online_followup_requests on public.online_followup_requests;
create trigger trg_audit_online_followup_requests after insert or update or delete on public.online_followup_requests
  for each row execute function public.audit_log_generic();

-- Family courier consolidation (Dr. Yadav: 2 family members at the same
-- address should be ONE parcel, not two — see confirm_online_followup_
-- request_atomic's amount handling below for the matching price rule:
-- the courier surcharge is charged once per combined group, not once per
-- person). Nullable, additive — a delivery with no combination behaves
-- exactly as it does today.
alter table public.deliveries
  add column if not exists combined_with_delivery_id uuid references public.deliveries(id);

-- Atomic confirm — fully inlined (no cross-RPC calls; there is no
-- precedent anywhere in this codebase for one security definer function
-- calling another, and collect_payment_atomic's signature has been
-- reshaped 4 times across migrations, so calling it by name here would
-- create a second place to update on every future change to it).
--
-- Token generation mirrors check_in_existing_patient_atomic (advisory
-- lock, not a row lock — there's no visit row yet to lock). The visit is
-- inserted with visit_type='VIDEO' directly in one insert (never a
-- separate UPDATE afterward — that two-step pattern is the exact bug
-- documented against src/lib/db.ts's checkInExistingPatient, 06 Aug 2026:
-- an UPDATE that silently failed left every online visit billed as OPD).
-- visit_status stays 'REGISTERED' — collect_payment_atomic's own rule
-- (IF v_visit_status <> 'REGISTERED') deliberately leaves a REGISTERED
-- visit's status untouched after full payment, so this online follow-up
-- correctly surfaces in Prescribing Dr's queue (doctor.rx.index.tsx
-- includes REGISTERED) and correctly skips Case-Taking (it's a follow-up,
-- lifetime_visits > 1, per doctor.case.index.tsx's own REGISTERED filter)
-- — replicated here rather than diverging from that established rule.
create or replace function confirm_online_followup_request_atomic(
  p_request_id uuid,
  p_amount_confirmed numeric,
  p_payment_mode text,
  p_doc_id uuid,
  p_confirmed_by text
) returns jsonb as $$
declare
  v_status text;
  v_patient_id uuid;
  v_branch text;
  v_note text;
  v_delivery_method text;
  v_delivery_address_text text;
  v_token text;
  v_n int;
  v_visit_id uuid;
  v_payment_id uuid;
  v_delivery_id uuid;
  v_new_current_balance numeric;
  v_visit_date date := current_date;
begin
  if p_amount_confirmed is null or p_amount_confirmed <= 0 then
    raise exception 'Confirmed amount zero ya khaali nahi ho sakta';
  end if;

  select status, patient_id, branch, note, delivery_method, delivery_address_text
    into v_status, v_patient_id, v_branch, v_note, v_delivery_method, v_delivery_address_text
  from online_followup_requests
  where id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Request nahi mili';
  end if;
  if v_status <> 'AWAITING_PAYMENT' then
    raise exception 'Ye request already % ho chuki hai — dobara confirm nahi kar sakte', v_status;
  end if;

  -- Token generation (mirrors check_in_existing_patient_atomic)
  perform pg_advisory_xact_lock(hashtext(v_branch || v_visit_date::text));
  select count(*) into v_n from visits where visit_date = v_visit_date and branch = v_branch;
  v_token := 'T-' || lpad((v_n + 1)::text, 2, '0');

  insert into visits (patient_id, visit_date, visit_type, visit_status, token_number, branch, chief_complaint)
  values (v_patient_id, v_visit_date, 'VIDEO', 'REGISTERED', v_token, v_branch, v_note)
  returning id into v_visit_id;

  update patients
  set lifetime_visits = coalesce(lifetime_visits, 0) + 1
  where id = v_patient_id;

  update followups set status = 'DONE' where patient_id = v_patient_id and status = 'PENDING';

  -- Payment (mirrors collect_payment_atomic's insert shape, simplified —
  -- this flow is always a single full payment, no partial/credit/split).
  insert into payments (visit_id, patient_id, amount_charged, amount_received, balance_due, payment_mode, branch, notes)
  values (v_visit_id, v_patient_id, p_amount_confirmed, p_amount_confirmed, 0, p_payment_mode, v_branch, 'Online follow-up — payment screenshot confirmed')
  returning id into v_payment_id;

  insert into payment_splits (payment_id, mode, amount) values (v_payment_id, p_payment_mode, p_amount_confirmed);

  select coalesce(sum(balance_due), 0) into v_new_current_balance from payments where patient_id = v_patient_id;
  update patients
  set lifetime_revenue = coalesce(lifetime_revenue, 0) + p_amount_confirmed,
      current_balance = v_new_current_balance
  where id = v_patient_id;
  -- visit_status intentionally left at 'REGISTERED' — see comment above the function.

  -- Delivery, if this isn't a self-pickup
  if v_delivery_method in ('JAIPUR_COURIER', 'COURIER') then
    insert into deliveries (patient_id, visit_id, partner, address, advance_amount_paid, branch, status)
    values (v_patient_id, v_visit_id, 'Courier', v_delivery_address_text, p_amount_confirmed, v_branch, 'Packed')
    returning id into v_delivery_id;
  end if;

  update online_followup_requests
  set status = 'CONFIRMED',
      visit_id = v_visit_id,
      delivery_id = v_delivery_id,
      confirmed_by = p_confirmed_by,
      confirmed_at = now(),
      amount_confirmed = p_amount_confirmed,
      payment_screenshot_doc_id = p_doc_id
  where id = p_request_id;

  return jsonb_build_object('visit_id', v_visit_id, 'token_number', v_token, 'delivery_id', v_delivery_id);
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function confirm_online_followup_request_atomic(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function confirm_online_followup_request_atomic(uuid, numeric, text, uuid, text) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0081_online_followup_requests', 'Adds online_followup_requests table + confirm_online_followup_request_atomic — payment-gated online follow-up flow, visit only created at confirm time; adds deliveries.combined_with_delivery_id for family courier consolidation')
on conflict (filename) do nothing;
