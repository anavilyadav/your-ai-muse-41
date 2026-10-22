-- 0096 — Stock counted in bottles per size; PL in the catalog (22 Oct 2026)
--
-- Dr. Yadav: Pharmacy counts stock as bottles of each size (11ml, 30ml,
-- 100ml, 450ml), and also stocks PL — non-medicated alcohol bottles from
-- the company, which have a size but no potency. Inventory only knew
-- medicine + potency + branch, so there was nowhere to put the size.
--
-- 1. inventory.bottle_size; increment_stock matches on it too, so each size
--    is its own stock line. Rows added before this keep a null size.
-- 2. dispense_visit_atomic no longer subtracts 0.5/4 "drams" per Rx line.
--    One bottle serves many patients, so that subtraction made a bottle
--    count wrong after two patients (and the item then vanished from the
--    doctor's in-stock picker). Pharmacy marks a finished bottle instead
--    (increment_stock with -1). Dispense still moves the visit to PAYMENT
--    and reports which Rx lines have no stock line at all.
-- 3. reorder_level default 0 (it was 50 drams; every bottle count looked low).
-- 4. "PL (Non-medicated Alcohol)" added to Medicine Master.

alter table public.inventory add column if not exists bottle_size text;

drop function if exists public.increment_stock(text, text, text, numeric, text, date);

create or replace function public.increment_stock(
  p_medicine_name text, p_potency text, p_branch text, p_quantity numeric,
  p_type text default null, p_expiry_date date default null, p_bottle_size text default null
)
returns json language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare
  v_id uuid;
  v_existing_expiry date;
begin
  select id, expiry_date into v_id, v_existing_expiry from inventory
  where medicine_name = p_medicine_name
    and potency is not distinct from p_potency
    and bottle_size is not distinct from p_bottle_size
    and branch = p_branch
    and not is_deleted
  for update;

  if v_id is null then
    insert into inventory (medicine_name, potency, bottle_size, branch, stock_drams, type, expiry_date)
    values (p_medicine_name, p_potency, p_bottle_size, p_branch, greatest(p_quantity, 0), p_type, p_expiry_date)
    returning id into v_id;
  else
    update inventory
    set stock_drams = greatest(coalesce(stock_drams, 0) + p_quantity, 0),
        expiry_date = case
          when p_expiry_date is null then v_existing_expiry
          when v_existing_expiry is null then p_expiry_date
          when p_expiry_date < v_existing_expiry then p_expiry_date
          else v_existing_expiry
        end
    where id = v_id;
  end if;

  return json_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.increment_stock(text, text, text, numeric, text, date, text) from public, anon;
grant execute on function public.increment_stock(text, text, text, numeric, text, date, text) to authenticated, service_role;

create or replace function public.dispense_visit_atomic(p_visit_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_visit_status text;
  v_branch text;
  r record;
  v_skipped jsonb := '[]'::jsonb;
begin
  select visit_status, branch into v_visit_status, v_branch
  from visits
  where id = p_visit_id
  for update;

  if v_visit_status is null then
    raise exception 'Visit not found';
  end if;

  if v_visit_status <> 'PHARMACY' then
    raise exception 'Yeh visit abhi Pharmacy stage mein nahi hai — dispense nahi kar sakte.';
  end if;

  update visits set visit_status = 'PAYMENT' where id = p_visit_id;

  for r in
    select distinct medicine_name, potency
    from prescriptions
    where visit_id = p_visit_id
  loop
    if not exists (
      select 1 from inventory
      where medicine_name = r.medicine_name
        and potency is not distinct from r.potency
        and branch = v_branch
        and not is_deleted
    ) then
      v_skipped := v_skipped || jsonb_build_object('medicine_name', r.medicine_name, 'potency', r.potency);
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'visit_id', p_visit_id,
    'decremented', '[]'::jsonb,
    'skipped_not_in_inventory', v_skipped
  );
end;
$function$;

-- reorder_level defaulted to 50 (drams), so every bottle count showed
-- "Low stock". In bottles, low means none left.
alter table public.inventory alter column reorder_level set default 0;
update public.inventory set reorder_level = 0 where reorder_level = 50;

insert into public.medicines (name)
select 'PL (Non-medicated Alcohol)'
where not exists (select 1 from public.medicines where lower(name) = lower('PL (Non-medicated Alcohol)') and not is_deleted);

insert into schema_migrations (filename, notes) values
  ('0096_inventory_bottle_sizes', 'inventory.bottle_size (stock counted in bottles per size), dispense no longer subtracts drams, PL added to Medicine Master')
on conflict (filename) do nothing;
