-- 0057 — Pharmacy expiry tracking (RF-17, master audit finding — "Missing
-- but important", not a bug: inventory had no expiry/batch/FEFO logic at
-- all). Scope confirmed with Dr. Yadav (17 Sep 2026): expiry date only,
-- no separate batch-number tracking; show a FEFO warning on the dispense
-- screen; existing stock without an expiry gets a reminder list, not a
-- forced backfill.
--
-- Model: one expiry_date per (medicine, potency, branch) row, same
-- granularity as stock itself already has — not true batch-level
-- tracking (the user explicitly chose "expiry date only" over "expiry +
-- batch number"). When new stock comes in with an expiry date, the
-- column is only ever moved EARLIER, never later — so what's on file is
-- always the soonest-expiring stock for that item, which is the
-- conservative, safety-correct choice for a FEFO warning (better to warn
-- early on some fresher stock than miss an actually-expiring batch).

alter table inventory add column if not exists expiry_date date;

drop function if exists increment_stock(text, text, text, numeric, text);

create or replace function increment_stock(
  p_medicine_name text,
  p_potency text,
  p_branch text,
  p_quantity numeric,
  p_type text default null,
  p_expiry_date date default null
) returns json as $$
declare
  v_id uuid;
  v_existing_expiry date;
begin
  select id, expiry_date into v_id, v_existing_expiry from inventory
  where medicine_name = p_medicine_name
    and potency is not distinct from p_potency
    and branch = p_branch
  for update;

  if v_id is null then
    insert into inventory (medicine_name, potency, branch, stock_drams, type, expiry_date)
    values (p_medicine_name, p_potency, p_branch, p_quantity, p_type, p_expiry_date)
    returning id into v_id;
  else
    update inventory
    set stock_drams = coalesce(stock_drams, 0) + p_quantity,
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
$$ language plpgsql set search_path to 'public', 'pg_temp';

revoke all on function increment_stock(text, text, text, numeric, text, date) from public, anon;
grant execute on function increment_stock(text, text, text, numeric, text, date) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0057_inventory_expiry_tracking', 'RF-17 — expiry-date-only tracking, FEFO dispense warning, missing-expiry reminder list; scope confirmed with Owner before building')
on conflict (filename) do nothing;
