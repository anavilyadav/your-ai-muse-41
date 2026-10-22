-- 0099 — Edit a stock line (22 Oct 2026)
--
-- Dr. Yadav: Pharmacy needs to correct a stock line after entering it —
-- name, potency, bottle size, bottle count or expiry. The count is set to
-- exactly what is typed (it is a correction, not a top-up). If the edited
-- line now matches another live line (same medicine + potency + size +
-- branch), its bottles are added to that line and this one is retired, so
-- an item never shows twice.

create or replace function public.edit_inventory_line(
  p_id uuid, p_medicine_name text, p_potency text, p_bottle_size text, p_count numeric, p_expiry_date date
)
returns json language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare
  v_row inventory%rowtype;
  v_target uuid;
  v_name text := nullif(trim(p_medicine_name), '');
  v_potency text := nullif(trim(p_potency), '');
  v_size text := nullif(trim(p_bottle_size), '');
begin
  if v_name is null then
    raise exception 'Medicine naam khaali nahi ho sakta';
  end if;
  if p_count is null or p_count < 0 then
    raise exception 'Bottles ki ginti 0 ya usse zyada honi chahiye';
  end if;

  select * into v_row from inventory where id = p_id and not is_deleted for update;
  if v_row.id is null then
    raise exception 'Stock line nahi mili';
  end if;

  select id into v_target from inventory
  where id <> p_id
    and medicine_name = v_name
    and potency is not distinct from v_potency
    and bottle_size is not distinct from v_size
    and branch = v_row.branch
    and not is_deleted
  for update;

  if v_target is null then
    update inventory
    set medicine_name = v_name, potency = v_potency, bottle_size = v_size,
        stock_drams = p_count, expiry_date = p_expiry_date, modified_at = now()
    where id = p_id;
    return json_build_object('success', true, 'id', p_id, 'merged', false);
  end if;

  update inventory
  set stock_drams = coalesce(stock_drams, 0) + p_count,
      expiry_date = case
        when p_expiry_date is null then expiry_date
        when expiry_date is null then p_expiry_date
        else least(expiry_date, p_expiry_date)
      end,
      modified_at = now()
  where id = v_target;
  update inventory set is_deleted = true, stock_drams = 0, modified_at = now() where id = p_id;
  return json_build_object('success', true, 'id', v_target, 'merged', true);
end;
$function$;

revoke all on function public.edit_inventory_line(uuid, text, text, text, numeric, date) from public, anon;
grant execute on function public.edit_inventory_line(uuid, text, text, text, numeric, date) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0099_edit_inventory_line', 'edit_inventory_line: correct a stock line''s name/potency/size/count/expiry, merging into a matching line')
on conflict (filename) do nothing;
