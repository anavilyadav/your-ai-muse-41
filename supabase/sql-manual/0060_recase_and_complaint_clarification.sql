-- Feature request (18 Sep 2026, Dr. Yadav):
--
-- 1. RECASE: case-taking isn't mandatory for a follow-up visit today (a
--    REGISTERED visit is already visible on both the Case Board and the
--    Doctor's Rx queue — the doctor can go straight to Rx). But if the
--    patient isn't responding to treatment, Dr. Yadav wants two escape
--    hatches from the Rx-writing screen:
--      a) "Recase Now" — send THIS visit back to the Case Board immediately,
--         a fresh case-taking round, a different Case-DR can pick it up.
--      b) "Recase Next Time" — don't disrupt today's visit, but flag the
--         PATIENT so their next check-in is forced through case-taking
--         (not skippable straight to Rx like a normal follow-up).
--
-- 2. COMPLAINT CLARIFICATION: Reception's initial complaint note is often
--    rough — they log only what they understood. The Junior Doctor then
--    calls, actually listens to the patient, and needs their own column to
--    write down the REAL complaint (separate from Reception's note and
--    separate from Dr. Yadav's answer) before resolving it.

alter table visits add column if not exists recased_at timestamptz;
alter table visits add column if not exists recase_reason text;
alter table visits add column if not exists needs_recase boolean not null default false;

alter table patients add column if not exists pending_recase boolean not null default false;
alter table patients add column if not exists recase_note text;

alter table patient_interactions add column if not exists clarified_note text;

-- check_in_existing_patient_atomic: if the patient carries a pending_recase
-- flag (set from the Rx screen's "Recase Next Time"), the new visit is
-- born with needs_recase=true and the flag is consumed (cleared) so it
-- fires exactly once, not on every future check-in.
create or replace function check_in_existing_patient_atomic(
  p_patient_id uuid,
  p_branch text,
  p_chief_complaint text default null,
  p_visit_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text;
  v_n int;
  v_visit_id uuid;
  v_needs_recase boolean;
begin
  perform pg_advisory_xact_lock(hashtext(p_branch || p_visit_date::text));

  select count(*) into v_n from visits where visit_date = p_visit_date and branch = p_branch;
  v_token := 'T-' || lpad((v_n + 1)::text, 2, '0');

  select coalesce(pending_recase, false) into v_needs_recase from patients where id = p_patient_id;

  insert into visits (patient_id, visit_date, visit_type, visit_status, token_number, branch, chief_complaint, needs_recase)
  values (p_patient_id, p_visit_date, 'OPD', 'REGISTERED', v_token, p_branch, p_chief_complaint, coalesce(v_needs_recase, false))
  returning id into v_visit_id;

  update patients
  set lifetime_visits = coalesce(lifetime_visits, 0) + 1,
      pending_recase = false
  where id = p_patient_id;

  update followups set status = 'DONE' where patient_id = p_patient_id and status = 'PENDING';

  return (select to_jsonb(v) from (select * from visits where id = v_visit_id) v);
end;
$$;

insert into schema_migrations (filename, notes) values
  ('0060_recase_and_complaint_clarification', 'Adds Recase Now / Recase Next Time (visits.needs_recase/recased_at, patients.pending_recase), and patient_interactions.clarified_note for the 3-field complaint workflow')
on conflict (filename) do nothing;
