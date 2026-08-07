-- 0034 — CRITICAL FIX: followups.followup_type CHECK constraint was
-- rejecting every single auto-scheduled follow-up since the touchpoints-
-- table-driven system (16 pre-due rules + 7-stage Day 0/2/5/9/14/19/25
-- post-due sequence) was built.
--
-- Already applied live via Supabase MCP on 06 Aug 2026 — this file is the
-- git record, no manual run needed. Found while auditing Follow-up CRM
-- completeness at Dr. Yadav's request.
--
-- Root cause: the CHECK constraint only allowed '7D','15D','30D','60D',
-- '90D','CUSTOM' — a leftover from an earlier, simpler design. The actual
-- system (generateFollowupSchedule in db.ts + reschedule_followups_atomic
-- RPC) writes the human-readable touchpoint LABEL instead (e.g. "Day 0
-- Call", "1 month: 15d before", "DEFAULT" as the no-match fallback) — none
-- of which satisfy the old enum. Every visit/payment that should have
-- scheduled follow-ups has been failing on this exact constraint since
-- migration 0027 (staged sequence) went live.
--
-- Live evidence: public.followups had 0 rows despite a real patient/visit
-- already existing. Confirmed by replaying the exact RPC call with a real
-- patient_id/visit_id — reproduced error 23514 on
-- followups_followup_type_check before this fix, succeeded after.
--
-- Fix: drop the rigid enum. followup_type is a descriptive label sourced
-- from followup_touchpoints.label, which is itself free text (Owner can
-- add custom touchpoints via the Follow-up Rules screen) — a fixed CHECK
-- list is fundamentally incompatible with that design, not a safety net
-- for it. NOT NULL + a sane length cap replaces it.
alter table public.followups drop constraint if exists followups_followup_type_check;
alter table public.followups alter column followup_type set not null;
alter table public.followups add constraint followups_followup_type_length_check
  check (char_length(followup_type) <= 100);
