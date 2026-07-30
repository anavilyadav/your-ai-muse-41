-- ============================================================================
-- YHC-OS — HOTFIX: visits_visit_status_check rejecting 'WAITING_DOCTOR'
--
-- Discovered live: Case-DR "Send to prescribing doctor" fails with
--   new row for relation "visits" violates check constraint "visits_visit_status_check"
-- because saveCaseNotes() (src/lib/db.ts) sets visit_status = 'WAITING_DOCTOR'
-- when a case is submitted, and the DB constraint apparently doesn't allow
-- that value (or was never updated to match the app code).
--
-- STEP 1 — run this first to see exactly what the constraint currently
-- allows (safe, read-only):
-- ============================================================================
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname = 'visits_visit_status_check';

-- ============================================================================
-- STEP 2 — after checking the output above, run this to replace the
-- constraint with the full set of values that actually appear in the app
-- code (src/lib/db.ts): REGISTERED, CASE_TAKING, WAITING, WAITING_DOCTOR,
-- PHARMACY, PAYMENT, DONE. CASE_TAKING/WAITING only show up in read-side
-- filters today (not in any write I could find), but including them costs
-- nothing and avoids this exact failure mode if something writes them later.
-- ============================================================================
alter table visits drop constraint if exists visits_visit_status_check;

alter table visits add constraint visits_visit_status_check
  check (visit_status in (
    'REGISTERED', 'CASE_TAKING', 'WAITING', 'WAITING_DOCTOR',
    'PHARMACY', 'PAYMENT', 'DONE'
  ));

-- ============================================================================
-- VERIFY — should now list all 7 values in the definition:
-- ============================================================================
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname = 'visits_visit_status_check';
