-- 0094 — Re-adding a removed staff member's mobile number works (22 Oct 2026)
--
-- Removing staff only soft-deletes the users row, but users.mobile is
-- unique across ALL rows, so adding the same person again failed with a
-- duplicate-key error. Dr. Yadav hit this removing and re-adding Deepika
-- (Pharmacy). Adding a mobile that belongs to a removed profile now brings
-- that profile back with the new name/role/branch; adding a mobile that an
-- active staff member already uses gets a clear message instead of a raw
-- constraint error.

create or replace function public.upsert_staff_profile_atomic(p_id uuid, p_name text, p_mobile text, p_role text, p_branch text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_caller_role text;
  v_existing record;
  v_result record;
begin
  select role into v_caller_role from public.users where id = auth.uid();
  if v_caller_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can add or edit staff';
  end if;

  if p_id is null then
    select id, name, is_deleted into v_existing from users where mobile = p_mobile;
    if v_existing.id is not null and not v_existing.is_deleted then
      raise exception 'Is mobile number se staff pehle se hai: %', v_existing.name;
    end if;

    if v_existing.id is not null then
      update users
      set name = p_name, role = p_role, branch = p_branch, is_active = true, is_deleted = false
      where id = v_existing.id
      returning id, name, mobile, role, branch into v_result;
    else
      insert into users (name, mobile, role, branch, is_active, has_login)
      values (p_name, p_mobile, p_role, p_branch, true, false)
      returning id, name, mobile, role, branch into v_result;
    end if;
  else
    update users
    set name = p_name, mobile = p_mobile, role = p_role, branch = p_branch
    where id = p_id
    returning id, name, mobile, role, branch into v_result;

    if v_result.id is null then
      raise exception 'Staff record nahi mila';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_result.id, 'name', v_result.name, 'mobile', v_result.mobile,
    'role', v_result.role, 'branch', v_result.branch
  );
end;
$function$;

insert into schema_migrations (filename, notes) values
  ('0094_readd_deleted_staff', 'Adding a removed staff member''s mobile again revives their profile instead of failing on the unique mobile constraint')
on conflict (filename) do nothing;
