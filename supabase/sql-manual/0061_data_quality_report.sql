-- 0061 — Data Quality report RPC (21 Sep 2026)
--
-- User's request before the planned bulk historical-data import: existing
-- manually-entered patients have inconsistent mobile numbers, spelling
-- mistakes, incomplete names, and wrong card-number entries — scattered
-- across individual patient profiles with no single place to see how many
-- records have each kind of mistake. This RPC scans `patients` server-side
-- (cheap at clinic scale, and avoids pulling the whole table to the client
-- past PostgREST's ~1000-row default cap) and returns every flagged group
-- in one JSON payload for the new Owner > Data Quality screen. It is a
-- live read every time it's called — there is no separate synced "sheet"
-- to go stale, which is the point (see owner.data-quality.tsx).
--
-- Checks:
--   incomplete_names   — name missing or a single word (no surname/second word)
--   shared_mobiles     — same mobile number on 2+ different patient records
--                         (family members sharing a phone is normal; the
--                         list itself is shown so the Owner can judge each
--                         cluster rather than the system guessing)
--   partial_card       — only SOME of card_series/card_register/card_number
--                         filled in (the three are meant to always travel
--                         together, per 0047's card-number redesign)
--   duplicate_cards    — the exact same (series, register, number) triple
--                         assigned to 2+ patients — almost always a mistake
--                         (see the comment on isDuplicateCardNumber in db.ts)
--   invalid_mobile     — present but not a clean 10-digit number
--   invalid_email      — present but not a plausible email shape
--
-- Owner-only, same server-side role guard as 0049's resolve_payment_adjustment
-- and merge_patients_atomic (client-side AuthGate alone isn't enough — any
-- authenticated staff member could otherwise call the RPC directly and see
-- every patient's PII in bulk).

create or replace function public.data_quality_report()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can view the data quality report';
  end if;

  select jsonb_build_object(
    'generated_at', now(),

    'incomplete_names', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'mobile', mobile, 'patient_code', patient_code)), '[]'::jsonb)
      from (
        select id, name, mobile, patient_code, created_at from patients
        where is_deleted = false and (name is null or trim(name) = '' or position(' ' in trim(name)) = 0)
        order by created_at desc
        limit 500
      ) t
    ),
    'incomplete_names_total', (
      select count(*) from patients
      where is_deleted = false and (name is null or trim(name) = '' or position(' ' in trim(name)) = 0)
    ),

    'shared_mobiles', (
      select coalesce(jsonb_agg(jsonb_build_object('mobile', mobile, 'count', cnt, 'patients', members) order by cnt desc), '[]'::jsonb)
      from (
        select mobile, count(*) cnt,
               jsonb_agg(jsonb_build_object('id', id, 'name', name, 'patient_code', patient_code) order by created_at) as members
        from patients
        where is_deleted = false and mobile is not null and trim(mobile) <> ''
        group by mobile
        having count(*) > 1
        order by count(*) desc
        limit 200
      ) s
    ),
    'shared_mobiles_total', (
      select count(*) from (
        select mobile from patients
        where is_deleted = false and mobile is not null and trim(mobile) <> ''
        group by mobile having count(*) > 1
      ) x
    ),

    'partial_card', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'patient_code', patient_code,
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number
      )), '[]'::jsonb)
      from (
        select id, name, patient_code, card_series, card_register, card_number, created_at from patients
        where is_deleted = false and (
          (coalesce(trim(card_series), '') <> '') <> (coalesce(trim(card_register), '') <> '')
          or (coalesce(trim(card_register), '') <> '') <> (coalesce(trim(card_number), '') <> '')
        )
        order by created_at desc
        limit 500
      ) t
    ),
    'partial_card_total', (
      select count(*) from patients
      where is_deleted = false and (
        (coalesce(trim(card_series), '') <> '') <> (coalesce(trim(card_register), '') <> '')
        or (coalesce(trim(card_register), '') <> '') <> (coalesce(trim(card_number), '') <> '')
      )
    ),

    'duplicate_cards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number,
        'count', cnt, 'patients', members
      ) order by cnt desc), '[]'::jsonb)
      from (
        select card_series, card_register, card_number, count(*) cnt,
               jsonb_agg(jsonb_build_object('id', id, 'name', name, 'patient_code', patient_code) order by created_at) as members
        from patients
        where is_deleted = false
          and card_series is not null and trim(card_series) <> ''
          and card_register is not null and trim(card_register) <> ''
          and card_number is not null and trim(card_number) <> ''
        group by card_series, card_register, card_number
        having count(*) > 1
        limit 200
      ) d
    ),

    'invalid_mobile', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'mobile', mobile, 'patient_code', patient_code)), '[]'::jsonb)
      from (
        select id, name, mobile, patient_code, created_at from patients
        where is_deleted = false and (mobile is null or trim(mobile) = '' or length(regexp_replace(mobile, '\D', '', 'g')) <> 10)
        order by created_at desc
        limit 500
      ) t
    ),
    'invalid_mobile_total', (
      select count(*) from patients
      where is_deleted = false and (mobile is null or trim(mobile) = '' or length(regexp_replace(mobile, '\D', '', 'g')) <> 10)
    ),

    'invalid_email', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email, 'patient_code', patient_code)), '[]'::jsonb)
      from (
        select id, name, email, patient_code, created_at from patients
        where is_deleted = false and email is not null and trim(email) <> '' and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        order by created_at desc
        limit 500
      ) t
    ),
    'invalid_email_total', (
      select count(*) from patients
      where is_deleted = false and email is not null and trim(email) <> '' and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.data_quality_report() from public, anon;
grant execute on function public.data_quality_report() to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0061_data_quality_report', 'Adds data_quality_report() RPC — incomplete names, shared mobiles, partial/duplicate card numbers, invalid mobile/email, for the new Owner > Data Quality screen')
on conflict (filename) do nothing;
