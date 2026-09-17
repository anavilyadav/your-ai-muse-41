-- 0054 — Fix "Edit Staff"/"Add Staff" (RF-01/RF-02) and lock settings writes
-- to Owner (RF-03), all three found and verified live during the master
-- production audit (17 Sep 2026).
--
-- RF-01/RF-02: addStaffProfile/updateStaffProfile write directly to the
-- `users` table, which (correctly, deliberately) has no INSERT/UPDATE/
-- DELETE RLS policy for `authenticated` — only the 2 SELECT policies from
-- 0043. That's right for staff PIN/role data being read-sensitive, but
-- nobody added an Owner-gated write path back for it when Phase 1 RLS
-- shipped, so even the real Owner's own "Add Staff"/"Edit Staff" broke:
-- INSERT throws an RLS violation outright, and UPDATE silently affects 0
-- rows with no error (RLS just filters the row, Postgres doesn't error on
-- a 0-row UPDATE) — updateStaffProfile never checked the affected-row
-- count, so the Owner saw a false success. Verified live in the running
-- app, not just SQL: edited a real staff member's name, got a clean
-- "success" close on the modal, name never changed.
--
-- Fix: same pattern already proven safe in this codebase (merge_patients_
-- atomic, resolve_payment_adjustment, restore_trashed_row) — one
-- SECURITY DEFINER RPC that checks the caller's real role via auth.uid()
-- before writing, rather than opening up `users` INSERT/UPDATE broadly.
-- db.ts's addStaffProfile/updateStaffProfile now call this instead of a
-- direct table write.

create or replace function upsert_staff_profile_atomic(
  p_id uuid,
  p_name text,
  p_mobile text,
  p_role text,
  p_branch text
) returns jsonb as $$
declare
  v_caller_role text;
  v_result record;
begin
  select role into v_caller_role from public.users where id = auth.uid();
  if v_caller_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can add or edit staff';
  end if;

  if p_id is null then
    insert into users (name, mobile, role, branch, is_active)
    values (p_name, p_mobile, p_role, p_branch, true)
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
$$ language plpgsql security definer set search_path to 'public';

revoke all on function upsert_staff_profile_atomic(uuid, text, text, text, text) from public, anon;
grant execute on function upsert_staff_profile_atomic(uuid, text, text, text, text) to authenticated, service_role;

-- RF-03: `settings` had one blanket "settings_staff_all" policy (ALL
-- commands, USING(true)) from RLS Phase 1 — meaning ANY authenticated
-- staff member, not just Owner, could write directly to fee master, the
-- WhatsApp master switch, incentive splits, permission toggles, etc.,
-- completely bypassing every Owner-only screen. Verified live: a real
-- Reception account successfully updated the `whatsapp_controls` row
-- directly. Every actual write call site for `settings` (upsertSetting in
-- db.ts) is already only ever invoked from Owner-gated UI, so restricting
-- writes to Owner at the DB layer doesn't break any legitimate workflow —
-- it just makes the existing UI-only restriction real. Reads stay open to
-- every staff member (the separate "Staff can read settings" policy from
-- 0043 is untouched) since fee amounts, SLX instructions, slot config
-- etc. are legitimately read by non-Owner screens during normal use.

drop policy if exists settings_staff_all on public.settings;

create policy settings_owner_insert on public.settings
  for insert to authenticated
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'OWNER'));

create policy settings_owner_update on public.settings
  for update to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'OWNER'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'OWNER'));

create policy settings_owner_delete on public.settings
  for delete to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'OWNER'));

insert into schema_migrations (filename, notes) values
  ('0054_staff_profile_rpc_and_settings_owner_write', 'applied same session as the master audit — fixes RF-01/RF-02/RF-03, verified live')
on conflict (filename) do nothing;
