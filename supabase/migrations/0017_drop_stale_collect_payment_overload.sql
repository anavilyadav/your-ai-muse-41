-- ============================================================================
-- YHC-OS — HOTFIX: duplicate collect_payment_atomic overloads
--
-- Discovered live: after running migration 0012, querying pg_proc shows
-- TWO versions of collect_payment_atomic -- pronargs 7 (the old one) and
-- pronargs 8 (the new one with p_credit_to_apply). This is because
-- CREATE OR REPLACE FUNCTION only replaces a function with the EXACT same
-- argument signature -- adding a new parameter changed the signature, so
-- Postgres created a second, separate overloaded function instead of
-- replacing the first one. Both now exist. The app always calls with all
-- 8 named parameters (see collectPayment in src/lib/db.ts), so it should
-- resolve to the new one -- but leaving a stale old version sitting in
-- the database is a landmine for any future direct call with only 7 args,
-- and two functions with the same name is confusing to audit later.
--
-- STEP 1 — verify both overloads exist and see their exact signatures
-- (safe, read-only):
-- ============================================================================
select p.oid, p.pronargs, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
where p.proname = 'collect_payment_atomic';

-- ============================================================================
-- STEP 2 — drop ONLY the old 7-argument version (the one WITHOUT
-- p_credit_to_apply). This targets the exact old signature so it can't
-- accidentally drop the new 8-arg one.
-- ============================================================================
drop function if exists collect_payment_atomic(
  uuid, uuid, numeric, numeric, text, text, text
);

-- ============================================================================
-- VERIFY — should now show exactly ONE row, pronargs = 8:
-- ============================================================================
select p.oid, p.pronargs, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
where p.proname = 'collect_payment_atomic';
