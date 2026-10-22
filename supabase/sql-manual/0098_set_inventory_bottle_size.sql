-- 0098 — Give a size to stock lines entered before sizes existed (22 Oct 2026)
--
-- Stock added before 0096 has no bottle_size ("size nahi likha"). Dr. Yadav
-- wants Pharmacy to set the size on those lines. If a line for the same
-- medicine + potency + size + branch already exists, the bottles are added
-- to it and the size-less line is retired, so one item never shows twice.

create or replace function public.set_inventory_bottle_size(p_id uuid, p_bottle_size text)
returns json language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare
  v_row inventory%rowtype;
  v_target uuid;
begin
  if coalesce(trim(p_bottle_size), '') = '' then
    raise exception 'Size chuno';
  end if;

  select * into v_row from inventory where id = p_id and not is_deleted for update;
  if v_row.id is null then
    raise exception 'Stock line nahi mili';
  end if;

  select id into v_target from inventory
  where id <> p_id
    and medicine_name = v_row.medicine_name
    and potency is not distinct from v_row.potency
    and bottle_size = p_bottle_size
    and branch = v_row.branch
    and not is_deleted
  for update;

  if v_target is null then
    update inventory set bottle_size = p_bottle_size where id = p_id;
    return json_build_object('success', true, 'id', p_id, 'merged', false);
  end if;

  update inventory
  set stock_drams = coalesce(stock_drams, 0) + coalesce(v_row.stock_drams, 0),
      expiry_date = case
        when v_row.expiry_date is null then expiry_date
        when expiry_date is null then v_row.expiry_date
        else least(expiry_date, v_row.expiry_date)
      end
  where id = v_target;
  update inventory set is_deleted = true, stock_drams = 0 where id = p_id;
  return json_build_object('success', true, 'id', v_target, 'merged', true);
end;
$function$;

revoke all on function public.set_inventory_bottle_size(uuid, text) from public, anon;
grant execute on function public.set_inventory_bottle_size(uuid, text) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0098_set_inventory_bottle_size', 'set_inventory_bottle_size: give a size to a size-less stock line, merging into an existing line of that size')
on conflict (filename) do nothing;
