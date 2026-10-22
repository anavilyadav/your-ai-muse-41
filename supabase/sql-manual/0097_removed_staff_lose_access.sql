-- 0097 — A removed staff member loses access at once (22 Oct 2026)
--
-- Dr. Yadav: "jab me staff delete kru to fir wo vapas open hi na kar paye
-- app". Removing staff soft-deletes the users row and bans the Auth login,
-- but every RLS policy is `true` for any authenticated session, so a phone
-- that was already signed in kept full read/write access until its access
-- token expired (up to an hour), and is_staff()/is_owner()/
-- current_staff_role() still counted the removed row.
--
-- 1. is_active_staff(): the session belongs to a users row that is not
--    removed. One RESTRICTIVE policy per public table ANDs this onto every
--    existing policy, so a removed staff member's live token is refused on
--    the very next request. (anon is untouched — the policy is for
--    authenticated only — and edge functions use the service role.)
-- 2. The three role helpers ignore removed rows too.
-- 3. my_staff_status(): lets the app tell "removed" apart from a slow
--    network, so it signs the person out instead of showing a retry screen.
-- 4. Marking a profile removed deletes its Auth sessions (and with them the
--    refresh tokens), so the app cannot quietly get a new token either.

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and not u.is_deleted);
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and not u.is_deleted);
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'OWNER' and not u.is_deleted);
$$;

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = public as $$
  select u.role from public.users u where u.id = auth.uid() and not u.is_deleted limit 1;
$$;

create or replace function public.my_staff_status()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'NONE'
    when exists (select 1 from public.users u where u.id = auth.uid() and not u.is_deleted) then 'ACTIVE'
    when exists (select 1 from public.users u where u.id = auth.uid()) then 'REMOVED'
    else 'NONE'
  end;
$$;

revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.my_staff_status() from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;
grant execute on function public.my_staff_status() to authenticated, service_role;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists active_staff_only on public.%I', t.tablename);
    execute format(
      'create policy active_staff_only on public.%I as restrictive for all to authenticated using ((select public.is_active_staff())) with check ((select public.is_active_staff()))',
      t.tablename
    );
  end loop;
end $$;

create or replace function public.end_sessions_of_removed_staff()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.is_deleted and not coalesce(old.is_deleted, false) then
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end $$;

revoke all on function public.end_sessions_of_removed_staff() from public, anon, authenticated;

drop trigger if exists trg_end_sessions_of_removed_staff on public.users;
create trigger trg_end_sessions_of_removed_staff after update of is_deleted on public.users
  for each row execute function public.end_sessions_of_removed_staff();

insert into schema_migrations (filename, notes) values
  ('0097_removed_staff_lose_access', 'Restrictive active_staff_only policy on every public table, role helpers ignore removed staff, my_staff_status() for the app, and removing staff ends their sessions')
on conflict (filename) do nothing;
