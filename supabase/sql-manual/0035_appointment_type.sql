-- ============================================================================
-- YHC-OS — Appointment type (New Case vs Follow-up) — 10 Aug 2026
-- Run ONCE in Supabase SQL Editor for project swekxnhvecrcpiuteqmj. Safe to
-- re-run (IF NOT EXISTS / CREATE OR REPLACE throughout).
--
-- WHY
-- New-case consultations run 30-60 min and are handled by Junior Doctors;
-- follow-ups run much shorter. Booking both into the same undifferentiated
-- slot grid made it hard for reception to book quickly and impossible for
-- the Owner to cap how many of each the clinic takes per day. This adds a
-- type column so a slot's duration and any daily cap can differ by type —
-- the actual duration/cap values live in the existing `appointment_slot_config`
-- settings JSON (src/lib/db.ts SlotConfig), not in SQL.
--
-- Doctor assignment is deliberately NOT part of this migration (Dr. Yadav's
-- decision, 10 Aug 2026) — New Case appointments get their own slot
-- duration/cap but aren't yet tied to a specific Junior Doctor. That can be
-- a later addition without touching this column.
-- ============================================================================

alter table public.appointments
  add column if not exists appointment_type text not null default 'FOLLOWUP';

alter table public.appointments
  drop constraint if exists appointments_appointment_type_check;

alter table public.appointments
  add constraint appointments_appointment_type_check
  check (appointment_type in ('NEW', 'FOLLOWUP'));
