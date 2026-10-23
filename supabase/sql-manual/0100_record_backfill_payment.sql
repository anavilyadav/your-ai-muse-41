-- 0100 — Record the fee for a back-dated entry (23 Oct 2026)
--
-- "Purani Tareekh Se Entry" saved every back-dated visit as DONE and only
-- then tried to take the registration payment. collect_payment_atomic
-- refuses a DONE visit, so every such patient (about 110 since 23 Sep) was
-- stored with ₹0 — e.g. Ananta Yadav, who really paid ₹3500 on 3 Oct.
-- register.tsx now takes the payment before closing the visit. This adds
-- the way to record the fee for the entries already saved.
--
-- Only an app-entered, back-dated visit that has no payment at all can be
-- filled in, and only once; it never changes the visit's status. The payment
-- is dated on the visit's own day so date-wise reports count it there.

create or replace function public.record_backfill_payment(
  p_visit_id uuid, p_amount numeric, p_mode text, p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v record;
  v_payment_id uuid;
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

  insert into payments (visit_id, patient_id, amount_charged, amount_received, balance_due, payment_mode, branch, notes, created_at)
  values (
    p_visit_id, v.patient_id, p_amount, p_amount, 0, coalesce(nullif(p_mode, ''), 'CASH'), v.branch,
    coalesce(p_notes, 'Registration fee') || ' (purani tareekh ki entry, baad me darj)',
    (v.visit_date::timestamp + interval '12 hours') at time zone 'Asia/Kolkata'
  )
  returning id into v_payment_id;

  insert into payment_splits (payment_id, mode, amount)
  values (v_payment_id, coalesce(nullif(p_mode, ''), 'CASH'), p_amount);

  update patients set lifetime_revenue = coalesce(lifetime_revenue, 0) + p_amount where id = v.patient_id;

  return jsonb_build_object('payment_id', v_payment_id, 'visit_id', p_visit_id, 'amount', p_amount);
end;
$function$;

revoke all on function public.record_backfill_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_backfill_payment(uuid, numeric, text, text) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0100_record_backfill_payment', 'record_backfill_payment: fill in the fee of an app-entered back-dated visit that was saved with no payment')
on conflict (filename) do nothing;
