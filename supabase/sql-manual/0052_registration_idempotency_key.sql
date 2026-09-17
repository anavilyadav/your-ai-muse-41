-- 0052 — Registration idempotency key (#14 offline register, 17 Sep 2026)
--
-- Same problem 0025 already fixed for collect_payment_atomic, now for
-- register_patient_with_visit: clinic wifi drops mid-request, or the
-- offline queue (src/lib/offlineQueue.ts) retries a registration whose
-- first attempt actually reached the server but whose response never
-- came back — without a key, that retry creates a second, duplicate
-- patient + visit for what was really one registration.
--
-- Fix: visits gets a nullable, uniquely-indexed idempotency_key column.
-- The client generates one key per registration attempt (reused across
-- every retry of that same submission, including offline-queue replays)
-- and passes it through. register_patient_with_visit() checks for an
-- existing visit with that key and returns the original patient+visit
-- instead of inserting again.

alter table visits add column if not exists idempotency_key text;

create unique index if not exists visits_idempotency_key_uidx
  on visits (idempotency_key)
  where idempotency_key is not null;

drop function if exists register_patient_with_visit(text, text, integer, text, text, text, text, text, boolean, text, text, text);

create or replace function register_patient_with_visit(
  p_name text,
  p_mobile text,
  p_age integer,
  p_gender text,
  p_blood_group text,
  p_city text,
  p_pincode text,
  p_primary_disease text,
  p_wa_consent boolean,
  p_branch text,
  p_chief_complaint text,
  p_visit_date text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_patient_code text;
  v_token text;
  v_patient_count int;
  v_visit_count int;
  new_patient_id uuid;
  new_visit_id uuid;
  result jsonb;
  v_existing_visit_id uuid;
begin
  if p_idempotency_key is not null then
    select id into v_existing_visit_id from visits where idempotency_key = p_idempotency_key;
    if v_existing_visit_id is not null then
      select jsonb_build_object('patient', to_jsonb(p.*), 'visit', to_jsonb(v.*), 'idempotent_replay', true)
      into result
      from patients p, visits v
      where v.id = v_existing_visit_id and p.id = v.patient_id;
      return result;
    end if;
  end if;

  select count(*) into v_patient_count from patients;
  v_patient_code := 'YHC-' || (1000 + v_patient_count + 1)::text;

  select count(*) into v_visit_count from visits where visit_date = p_visit_date::date and branch = p_branch;
  v_token := 'T-' || lpad((v_visit_count + 1)::text, 2, '0');

  insert into patients (patient_code, name, mobile, age, gender, blood_group, city, pincode, primary_disease, wa_consent, branch, lifetime_visits)
  values (v_patient_code, p_name, p_mobile, p_age, p_gender, p_blood_group, p_city, p_pincode, p_primary_disease, p_wa_consent, p_branch, 1)
  returning id into new_patient_id;

  insert into visits (patient_id, visit_date, visit_type, visit_status, token_number, branch, chief_complaint, idempotency_key)
  values (new_patient_id, p_visit_date::date, 'OPD', 'REGISTERED', v_token, p_branch, p_chief_complaint, p_idempotency_key)
  returning id into new_visit_id;

  select jsonb_build_object('patient', to_jsonb(p.*), 'visit', to_jsonb(v.*))
  into result
  from patients p, visits v
  where p.id = new_patient_id and v.id = new_visit_id;

  return result;
end;
$function$;

-- register_patient_with_visit had no explicit grants set (INVOKER, relies
-- on table-level RLS which already allows authenticated staff to insert
-- into patients/visits) — CREATE OR REPLACE on the SAME signature keeps
-- whatever grants exist; this is a genuinely new 13-arg signature (the
-- DROP above removed the old 12-arg one first, so there's no overload
-- ambiguity), so grants must be set explicitly here rather than assumed.
revoke all on function register_patient_with_visit(text, text, integer, text, text, text, text, text, boolean, text, text, text, text) from public, anon;
grant execute on function register_patient_with_visit(text, text, integer, text, text, text, text, text, boolean, text, text, text, text) to authenticated, service_role;

select proname, pronargs from pg_proc where proname = 'register_patient_with_visit';
