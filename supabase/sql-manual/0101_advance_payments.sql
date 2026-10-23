-- 0101 — Advance payments (23 Oct 2026)
--
-- Dr. Yadav: a patient who has already paid (e.g. Ananta Yadav's ₹3500 at
-- the start) and is now waiting for the consultation should show in the
-- collection, while the visit stays pending exactly as it is.
--
-- payments.is_advance marks money taken before the consultation. It is kept
-- apart from the registration fee on purpose: the Pay screen deducts only
-- advances from the final bill, never the registration fee.
--
-- record_advance_payment adds a payment to an open (not DONE) visit WITHOUT
-- touching its status — collect_payment_atomic would close a visit that is
-- past the REGISTERED stage. record_backfill_payment (0100) gains a
-- p_keep_pending option: record the fee of a back-dated entry and put the
-- visit back to REGISTERED because the consultation has not happened yet.

alter table public.payments add column if not exists is_advance boolean not null default false;

create or replace function public.record_advance_payment(
  p_visit_id uuid, p_amount numeric, p_mode text, p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v record;
  v_payment_id uuid;
  v_mode text := coalesce(nullif(p_mode, ''), 'CASH');
begin
  if not public.is_active_staff() then
    raise exception 'permission denied';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount 0 se zyada hona chahiye';
  end if;

  select id, patient_id, branch, visit_status, is_deleted into v from visits where id = p_visit_id for update;
  if v.id is null or v.is_deleted then
    raise exception 'Visit nahi mili';
  end if;
  if v.visit_status = 'DONE' then
    raise exception 'Ye visit ho chuki hai — advance nahi, Pay screen se payment lo';
  end if;

  insert into payments (visit_id, patient_id, amount_charged, amount_received, balance_due, payment_mode, branch, notes, is_advance)
  values (p_visit_id, v.patient_id, p_amount, p_amount, 0, v_mode, v.branch,
          coalesce(p_notes, 'Advance payment'), true)
  returning id into v_payment_id;

  insert into payment_splits (payment_id, mode, amount) values (v_payment_id, v_mode, p_amount);

  update patients set lifetime_revenue = coalesce(lifetime_revenue, 0) + p_amount where id = v.patient_id;

  return jsonb_build_object('payment_id', v_payment_id, 'visit_id', p_visit_id, 'amount', p_amount);
end;
$function$;

revoke all on function public.record_advance_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_advance_payment(uuid, numeric, text, text) to authenticated, service_role;

-- Signature changes, so the old one is dropped explicitly (Postgres treats a
-- different parameter list as a new overload, not a replacement).
drop function if exists public.record_backfill_payment(uuid, numeric, text, text);

create or replace function public.record_backfill_payment(
  p_visit_id uuid, p_amount numeric, p_mode text, p_notes text default null, p_keep_pending boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v record;
  v_payment_id uuid;
  v_mode text := coalesce(nullif(p_mode, ''), 'CASH');
begin
  if not public.is_active_staff() then
    raise exception 'permission denied';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount 0 se zyada hona chahiye';
  end if;

  select id, patient_id, branch, visit_date, imported_batch, is_deleted, created_at
    into v from visits where id = p_visit_id for update;
  if v.id is null or v.is_deleted then
    raise exception 'Visit nahi mili';
  end if;
  if v.imported_batch is not null then
    raise exception 'Ye sheet se aayi visit hai — iska payment yahan se nahi daal sakte';
  end if;
  if v.visit_date >= (v.created_at at time zone 'Asia/Kolkata')::date then
    raise exception 'Ye purani tareekh ki entry nahi hai — Pay screen se payment lo';
  end if;
  if exists (select 1 from payments where visit_id = p_visit_id and not is_deleted) then
    raise exception 'Is visit ka payment pehle se darj hai';
  end if;

  insert into payments (visit_id, patient_id, amount_charged, amount_received, balance_due, payment_mode, branch, notes, created_at, is_advance)
  values (
    p_visit_id, v.patient_id, p_amount, p_amount, 0, v_mode, v.branch,
    coalesce(p_notes, case when p_keep_pending then 'Advance payment' else 'Registration fee' end)
      || ' (purani tareekh ki entry, baad me darj)',
    (v.visit_date::timestamp + interval '12 hours') at time zone 'Asia/Kolkata',
    p_keep_pending
  )
  returning id into v_payment_id;

  insert into payment_splits (payment_id, mode, amount) values (v_payment_id, v_mode, p_amount);

  update patients set lifetime_revenue = coalesce(lifetime_revenue, 0) + p_amount where id = v.patient_id;

  -- Consultation still to come: the visit goes back to waiting instead of Done.
  if p_keep_pending then
    update visits set visit_status = 'REGISTERED' where id = p_visit_id and visit_status = 'DONE';
  end if;

  return jsonb_build_object('payment_id', v_payment_id, 'visit_id', p_visit_id, 'amount', p_amount, 'pending', p_keep_pending);
end;
$function$;

revoke all on function public.record_backfill_payment(uuid, numeric, text, text, boolean) from public, anon;
grant execute on function public.record_backfill_payment(uuid, numeric, text, text, boolean) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0101_advance_payments', 'payments.is_advance, record_advance_payment (status untouched), record_backfill_payment gains p_keep_pending')
on conflict (filename) do nothing;
