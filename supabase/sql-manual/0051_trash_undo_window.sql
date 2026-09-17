-- 0051 — Generic trash / undo window (#12, Dr. Yadav's spec 17 Sep 2026)
--
-- Scope confirmed: patient document deletes, and every Owner-config
-- delete (payment modes, holidays, win-back tiers, follow-up touchpoint
-- rules) go through this. Restoring is Owner-only ("1 aur 4 sirf mai kr
-- sakoon baaki log nahi") — no staff member can un-delete anything
-- themselves, even something they just deleted. Window: until the end of
-- that IST calendar day, after which it's purged for real by a nightly
-- job (matching the existing pg_cron pattern this project already uses
-- for whatsapp-* and daily-backup).
--
-- Appointment "cancel" and follow-up "done" are status flips, not real
-- deletes (nothing is destroyed), so they get a lightweight client-side
-- undo toast instead of this trash system — see appointments.tsx /
-- follow-up.tsx.
--
-- One generic table + two RPCs instead of a deleted_at column and a
-- restore function per table — same "one generic thing beats N specific
-- things" reasoning as audit_log_generic (0020). table_name is checked
-- against an explicit allow-list inside soft_delete_row so it can never
-- be used to run dynamic SQL against an arbitrary table.

create table if not exists public.trash (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text not null,
  record_data jsonb not null,
  deleted_by uuid references public.users(id),
  deleted_by_role text,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references public.users(id),
  expires_at timestamptz not null
);

create index if not exists trash_expires_at_idx on public.trash (expires_at) where restored_at is null;
create index if not exists trash_table_name_idx on public.trash (table_name);

alter table public.trash enable row level security;
revoke all on public.trash from public, anon;
grant select on public.trash to authenticated;

drop policy if exists trash_staff_select on public.trash;
create policy trash_staff_select on public.trash for select to authenticated using (true);
-- Deliberately no insert/update/delete policy for `authenticated` — every
-- write to this table goes through the SECURITY DEFINER RPCs below, never
-- directly, so a soft-delete can't be forged and a restore can't skip the
-- Owner check.

create or replace function soft_delete_row(p_table text, p_record_id text) returns jsonb as $$
declare
  v_allowed text[] := array['patient_documents', 'payment_modes', 'holidays', 'winback_tiers', 'followup_touchpoints'];
  v_row jsonb;
  v_trash_id uuid;
  v_role text;
  v_end_of_day timestamptz;
begin
  if not (p_table = any(v_allowed)) then
    raise exception 'Ye table trash system se delete nahi ho sakti: %', p_table;
  end if;

  select role into v_role from public.users where id = auth.uid();

  execute format('select to_jsonb(t) from public.%I t where id = $1', p_table)
    into v_row using p_record_id::uuid;
  if v_row is null then
    raise exception 'Record nahi mila';
  end if;

  v_end_of_day := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) + interval '1 day') at time zone 'Asia/Kolkata';

  insert into trash (table_name, record_id, record_data, deleted_by, deleted_by_role, expires_at)
  values (p_table, p_record_id, v_row, auth.uid(), v_role, v_end_of_day)
  returning id into v_trash_id;

  execute format('delete from public.%I where id = $1', p_table) using p_record_id::uuid;

  return jsonb_build_object('trash_id', v_trash_id, 'expires_at', v_end_of_day);
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function soft_delete_row(text, text) from public, anon;
grant execute on function soft_delete_row(text, text) to authenticated, service_role;

create or replace function restore_trashed_row(p_trash_id uuid) returns jsonb as $$
declare
  v_role text;
  v_trash record;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can restore deleted records';
  end if;

  select * into v_trash from trash where id = p_trash_id for update;
  if not found then
    raise exception 'Trash entry nahi mila';
  end if;
  if v_trash.restored_at is not null then
    raise exception 'Ye pehle hi restore ho chuka hai';
  end if;
  if v_trash.expires_at < now() then
    raise exception 'Undo window khatam ho gaya — ye ab permanently delete ho chuka hai';
  end if;

  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
    v_trash.table_name, v_trash.table_name
  ) using v_trash.record_data;

  update trash set restored_at = now(), restored_by = auth.uid() where id = p_trash_id;

  return jsonb_build_object('success', true, 'table_name', v_trash.table_name, 'record_id', v_trash.record_id);
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function restore_trashed_row(uuid) from public, anon;
grant execute on function restore_trashed_row(uuid) to authenticated, service_role;

create or replace function purge_expired_trash() returns void as $$
begin
  delete from trash where restored_at is null and expires_at < now();
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function purge_expired_trash() from public, anon, authenticated;
grant execute on function purge_expired_trash() to service_role;

select cron.schedule(
  'purge-expired-trash',
  '35 19 * * *', -- 19:35 UTC = ~01:05 IST, after the IST-midnight expiry boundary
  $$select purge_expired_trash()$$
);
