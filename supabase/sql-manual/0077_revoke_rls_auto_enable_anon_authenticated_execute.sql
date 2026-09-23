-- 0077 — Follow-up to 0076 (23 Sep 2026)
--
-- `revoke execute ... from public` only removes the implicit blanket
-- grant every role inherits from PUBLIC — checking afterward showed
-- anon/authenticated still had EXECUTE on rls_auto_enable(), because
-- each had been granted it explicitly at some point, separate from
-- PUBLIC. Revoking those directly too, so only postgres/service_role
-- can call it.

revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;

insert into schema_migrations (filename, notes) values
  ('0077_revoke_rls_auto_enable_anon_authenticated_execute', 'Follow-up to 0076 — anon/authenticated each had an explicit EXECUTE grant on rls_auto_enable() separate from PUBLIC, revoking those too so only postgres/service_role can call it directly')
on conflict (filename) do nothing;
