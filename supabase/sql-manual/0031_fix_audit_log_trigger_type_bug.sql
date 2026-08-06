-- 0031 — CRITICAL FIX: audit_log_generic() trigger was rejecting every
-- single write to all 11 audited tables (appointments, deliveries,
-- followups, inventory, leads, patients, payments, prescriptions, settings,
-- users, visits) since migration 0020 went live on 29 Jul 2026.
--
-- Already applied live via Supabase MCP on 06 Aug 2026 — this file is the
-- git record, no manual run needed. Found by testing a real INSERT into
-- `leads` while verifying the Lead CRM fix (migration 0030) — the CRM fix
-- alone did not explain a fresh test row still failing to save, which led
-- to this.
--
-- Root cause: `coalesce(new.id, old.id)::text` inside the trigger produces
-- a `text` value, but audit_log.record_id is `uuid`. Postgres does not
-- implicitly cast text to uuid on INSERT, so the trigger's own audit-log
-- write raised a hard error (42804) on every fire — and because this is an
-- AFTER trigger with no exception handling, that error rolled back the
-- ENTIRE original transaction (the patient registration, payment, lead
-- insert, etc. that triggered it), not just the audit-log write.
--
-- Live evidence at the time of fix: public.audit_log had 0 rows despite
-- being deployed 8 days earlier — confirms this failed on every fire, not
-- intermittently. (The 1 test patient / 1 test visit already in the DB
-- predate 29 Jul, i.e. predate this trigger.)
--
-- Fix: drop the incorrect ::text cast — new.id/old.id are already uuid on
-- every one of the 11 audited tables (verified live against
-- information_schema.columns before applying), so the value now goes into
-- record_id with its native type, matching the column. Re-tested after
-- applying: a real INSERT into `leads` succeeded and a matching row
-- appeared in `audit_log` for the first time ever.
create or replace function public.audit_log_generic()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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
    coalesce(new.id, old.id),
    v_actor,
    v_role,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    now()
  );
  return coalesce(new, old);
end;
$$;
