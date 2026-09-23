-- 0076 — Security hygiene: revoke PUBLIC EXECUTE on rls_auto_enable() (23 Sep 2026)
--
-- Audit round 2 §3 (low priority, no real risk today, but cheap to close):
-- rls_auto_enable() is a DDL event-trigger function (fires automatically
-- on CREATE TABLE, per Postgres's event trigger mechanism) that
-- anon/authenticated had EXECUTE on purely because it defaulted to
-- PUBLIC. A plain direct call is a no-op outside a real CREATE TABLE
-- event, but no role should be able to invoke a SECURITY DEFINER
-- function directly that it has no legitimate reason to call. Matches
-- the same REVOKE-FROM-PUBLIC pattern already used for RF-14
-- (0029_security_hardening.sql).

revoke execute on function public.rls_auto_enable() from public;

insert into schema_migrations (filename, notes) values
  ('0076_revoke_rls_auto_enable_public_execute', 'Revokes PUBLIC EXECUTE on rls_auto_enable() — a DDL event-trigger function anon/authenticated could call directly with no legitimate reason to; event-trigger firing itself is unaffected (Postgres invokes it internally, not through a role''s own EXECUTE grant)')
on conflict (filename) do nothing;
