-- ============================================================================
-- YHC-OS — Card number: real 3-part Series/Register/Number — 10 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (IF NOT EXISTS throughout).
--
-- WHY
-- The existing card_number/card_register pair was built on a wrong
-- assumption: card_register held a doctor's name (defaulted to the logged-in
-- doctor in the Case-Taking form, labeled "Register (doctor name)" in the
-- UI). Dr. Yadav corrected this directly (10 Aug 2026): the clinic's real
-- physical filing system is Series (a letter or two, e.g. A, B, K, AA, AB)
-- -> Register number within that series (~100 registers per series) ->
-- Card number within that register, written as e.g. B-10-12.
--
-- card_number keeps its existing meaning (the card's number within its
-- register). card_register is repurposed from "doctor name" to "register
-- number" -- same column, corrected meaning, since no real production data
-- depended on the old meaning (patients table had exactly one seed row with
-- a placeholder doctor-name value, no real card numbers assigned yet).
-- card_series is new.
-- ============================================================================

alter table public.patients
  add column if not exists card_series text;
