-- 0020 — Full-detail audit log (Phase 3 decision #23, 29 Jul 2026)
--
-- Decision: "Sab kuch detail mein track hoga (Option 2 — full detail, not
-- just sensitive-only). Access: Sirf Owner dekh sakta hai."
--
-- An `audit_log` table already exists (used today only for pharmacy
-- STOCK_ISSUE reports — see reportStockIssue() / fetchStockIssues() in
-- src/lib/db.ts, columns: action, table_name, record_id, new_value,
-- created_at). That usage is untouched by this migration.
--
-- Hand-instrumenting every write call site across the app (~100+ functions
-- in db.ts) to log "who changed what" would be exactly the class of bug
-- this project keeps finding — a call site someone forgets, silently, one
-- day. A database trigger cannot be forgotten: it fires no matter which
-- screen, RPC, or future code path made the change. This adds one generic
-- trigger function and attaches it to every table that matters financially
-- or clinically. WHO made the change is read from auth.uid() — this app
-- signs staff in via real Supabase Auth (see src/lib/auth.tsx signIn()),
-- so every request already carries the staff member's identity; no new
-- plumbing needed for that part either.
--
-- NOTE: run this in Supabase SQL Editor, same as 0001-0019.

-- 1) New columns on the EXISTING audit_log table (old_value/new_value
-- already exist as plain text, used for the STOCK_ISSUE note — kept as-is.
-- These are new, separate columns for the generic trigger's full row
-- snapshots, so there is no collision with that existing usage).
alter table public.audit_log add column if not exists actor_id uuid;
alter table public.audit_log add column if not exists actor_role text;
alter table public.audit_log add column if not exists old_data jsonb;
alter table public.audit_log add column if not exists new_data jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.audit_log'::regclass
      and conname = 'audit_log_actor_id_fkey'
  ) then
    alter table public.audit_log
      add constraint audit_log_actor_id_fkey
      foreign key (actor_id) references public.users(id) on delete set null;
  end if;
end $$;

create index if not exists audit_log_table_name_idx on public.audit_log (table_name);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_id_idx on public.audit_log (actor_id);
create index if not exists audit_log_record_id_idx on public.audit_log (record_id);

-- 2) One generic trigger function, reused by every audited table.
create or replace function public.audit_log_generic()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
  v_role text;
begin
  v_actor := auth.uid();
  if v_actor is not null then
    select role into v_role from public.users where id = v_actor;
  end if;

  insert into public.audit_log (action, table_name, record_id, actor_id, actor_role, old_data, new_data, created_at)
  values (
    TG_OP,
    TG_TABLE_NAME,
    coalesce(new.id, old.id)::text,
    v_actor,
    v_role,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    now()
  );
  return coalesce(new, old);
end;
$$;

-- 3) Attach to every table that matters clinically, financially, or for
-- staff/config accountability. Dedup/notification tables (winback_log,
-- interactions, whatsapp_log, system_alerts, login_attempts...) are
-- themselves already a log of an event — auditing a log is noise, so
-- they're deliberately left out.
do $$
declare
  t text;
begin
  foreach t in array array[
    'patients', 'visits', 'prescriptions', 'payments', 'settings',
    'users', 'deliveries', 'appointments', 'leads', 'followups', 'inventory'
  ]
  loop
    execute format('drop trigger if exists trg_audit_%s on public.%I', t, t);
    execute format(
      'create trigger trg_audit_%s after insert or update or delete on public.%I
       for each row execute function public.audit_log_generic()',
      t, t
    );
  end loop;
end $$;
