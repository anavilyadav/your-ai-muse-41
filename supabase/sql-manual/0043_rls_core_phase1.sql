-- 0043_rls_core_phase1.sql
-- Row Level Security rollout, PHASE 1 — 26 Aug 2026
--
-- WHY THIS EXISTS
-- Until now not a single table had RLS enabled. That means anyone holding
-- the publishable/anon key (which ships inside the browser bundle, i.e.
-- it is effectively public) could read every patient name, mobile number,
-- case note and payment row straight off the Data API — no login needed.
-- That is the single largest exposure in the system.
--
-- WHAT PHASE 1 DOES (deliberately narrow)
-- It closes the anon hole WITHOUT changing what a logged-in staff member
-- can do. Every table gets:
--   * RLS enabled
--   * all privileges revoked from anon (and from PUBLIC)
--   * the privileges the app actually uses granted to `authenticated`
--   * a policy that allows `authenticated` exactly those operations
--   * full access for service_role (edge functions / cron), which bypasses
--     RLS anyway but needs the table grants
--
-- So the effective change is: "you must be signed in as a real staff user".
-- Staff sign-in already produces a genuine Supabase Auth session
-- (staff-signin -> supabase.auth.setSession), and users.id equals the auth
-- user id, so auth.uid() is meaningful here.
--
-- WHAT PHASE 1 DOES NOT DO (on purpose)
-- No per-role or per-branch row filtering yet. Screen-level access is
-- currently controlled by the owner's permission toggles in the app, and
-- tightening rows here in the same step would risk locking real staff out
-- of screens they use daily during clinic hours. Phase 2 (a separate
-- migration) narrows the sensitive tables per role using the helpers
-- defined below, which is why they are created now.
--
-- SAFE TO RE-RUN: every statement is idempotent.

-- ---------------------------------------------------------------------
-- Helpers (phase 2 will build role policies on these)
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so a policy on `users` can never recurse into itself,
-- search_path pinned (see 0029), and EXECUTE withheld from anon/PUBLIC.

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role FROM public.users u WHERE u.id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_staff_branch()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.branch FROM public.users u WHERE u.id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'OWNER')
$$;

REVOKE ALL ON FUNCTION public.current_staff_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_staff_branch() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_staff_branch() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Rollout
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
  -- Tables the app reads AND writes from the browser while signed in.
  rw_tables text[] := ARRAY[
    'patients', 'visits', 'payments', 'payment_splits', 'payment_adjustments',
    'prescriptions', 'followups', 'followup_touchpoints', 'appointments',
    'deliveries', 'interactions', 'patient_interactions', 'patient_documents',
    'inventory', 'medicines', 'leads', 'lead_sources', 'family_links',
    'holidays', 'settings', 'system_alerts', 'storage_backup_queue',
    'login_attempts', 'payment_modes', 'winback_tiers'
  ];
  -- Written only by edge functions / cron (service_role). Staff may read
  -- them for the health & WhatsApp log screens.
  ro_tables text[] := ARRAY[
    'users', 'whatsapp_log', 'winback_log', 'wa_consent_log',
    'holiday_greeting_log', 'webhook_hits'
  ];
BEGIN
  FOREACH t IN ARRAY rw_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'skipping missing table %', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_staff_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_staff_all', t
    );
  END LOOP;

  FOREACH t IN ARRAY ro_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'skipping missing table %', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_staff_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_staff_read', t
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- audit_log: append-only by design
-- ---------------------------------------------------------------------
-- Staff must be able to add entries and the owner must be able to read
-- them, but nobody with a browser session may edit or delete history —
-- an audit trail that can be rewritten is not an audit trail. Only
-- service_role (server-side) can ever change existing rows.
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE NOTICE 'skipping missing table audit_log';
    RETURN;
  END IF;

  ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.audit_log FROM PUBLIC, anon;
  GRANT SELECT, INSERT ON public.audit_log TO authenticated;
  GRANT ALL ON public.audit_log TO service_role;

  DROP POLICY IF EXISTS audit_log_staff_read ON public.audit_log;
  CREATE POLICY audit_log_staff_read ON public.audit_log
    FOR SELECT TO authenticated USING (true);

  DROP POLICY IF EXISTS audit_log_staff_insert ON public.audit_log;
  CREATE POLICY audit_log_staff_insert ON public.audit_log
    FOR INSERT TO authenticated WITH CHECK (true);
  -- No UPDATE or DELETE policy: absence of a policy = denied.
END;
$$;

-- ---------------------------------------------------------------------
-- Verification (run these after applying)
-- ---------------------------------------------------------------------
-- 1. Every public table should now show rowsecurity = true:
--    SELECT relname, relrowsecurity FROM pg_class c
--      JOIN pg_namespace n ON n.oid = c.relnamespace
--     WHERE n.nspname = 'public' AND c.relkind = 'r'
--     ORDER BY relrowsecurity, relname;
--
-- 2. anon must have zero table privileges left:
--    SELECT table_name, privilege_type FROM information_schema.role_table_grants
--     WHERE grantee = 'anon' AND table_schema = 'public';
--    -- expected: 0 rows
--
-- 3. Smoke test from the app: sign in as RECP1 and confirm queue,
--    registration, payment, doctor Rx and pharmacy dispense all still work.
--    Then sign out and confirm a raw anon-key REST read of /patients
--    returns a permission error rather than data.
