-- 0092 — New staff no longer look like they already have a login (22 Oct 2026)
--
-- users.has_login defaulted to TRUE, so a staff profile added without an
-- email/PIN (or whose login creation failed) showed up on the Staff page as
-- if a login existed: the "Set login email" sheet took the update-email
-- path instead of asking for a PIN, and no login was ever created. Deepika
-- (Pharmacy, added 22 Oct) could not sign in because of this.

alter table public.users alter column has_login set default false;

update public.users u set has_login = false
where u.has_login and not exists (select 1 from auth.users a where a.id = u.id);

create or replace function public.upsert_staff_profile_atomic(p_id uuid, p_name text, p_mobile text, p_role text, p_branch text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_caller_role text;
  v_result record;
begin
  select role into v_caller_role from public.users where id = auth.uid();
  if v_caller_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can add or edit staff';
  end if;

  if p_id is null then
    insert into users (name, mobile, role, branch, is_active, has_login)
    values (p_name, p_mobile, p_role, p_branch, true, false)
    returning id, name, mobile, role, branch into v_result;
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
  ('0092_staff_has_login_default_false', 'users.has_login defaults to false and is cleared for profiles with no Auth account, so the Staff page offers to create their login')
on conflict (filename) do nothing;
