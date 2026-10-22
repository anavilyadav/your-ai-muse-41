-- 0095 — Staff login creation links the profile reliably (22 Oct 2026)
--
-- create-staff-login created the Auth account and then re-pointed
-- users.id to it with a PostgREST PATCH whose error was never checked. That
-- PATCH was failing (500), so the Auth account existed but the staff
-- profile stayed on its old id with has_login=false — the person could
-- never sign in, and trying again failed because the email was already
-- registered. Deepika (Pharmacy) hit exactly this.
--
-- These two service-role-only helpers let the function (a) find an Auth
-- account already registered for the login email, so a half-finished
-- earlier attempt is reused instead of blocking, and (b) link the profile
-- in one statement that raises a real error if it can't.

create or replace function public.staff_auth_id_for_email(p_email text)
returns uuid language sql security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

create or replace function public.link_staff_login(p_mobile text, p_auth_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.users
  set id = p_auth_id, email = p_email, has_login = true
  where mobile = p_mobile;
  if not found then
    raise exception 'Staff profile for % not found', p_mobile;
  end if;
end $$;

revoke all on function public.staff_auth_id_for_email(text) from public, anon, authenticated;
revoke all on function public.link_staff_login(text, uuid, text) from public, anon, authenticated;
grant execute on function public.staff_auth_id_for_email(text) to service_role;
grant execute on function public.link_staff_login(text, uuid, text) to service_role;

insert into schema_migrations (filename, notes) values
  ('0095_link_staff_login', 'Service-role helpers so create-staff-login reuses an existing Auth account for the login email and links the staff profile with a checked error')
on conflict (filename) do nothing;
