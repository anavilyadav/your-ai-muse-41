-- 0075 — Data Quality: possible duplicate patients (23 Sep 2026)
--
-- data_quality_report()'s existing "duplicate_cards" check only catches
-- an EXACT (series, register, number) triple shared by 2+ patients —
-- genuinely 0 right now. But a real live case slipped past it: "Sulekha"
-- (mobile 7415582342) got imported as TWO separate patient records,
-- 7 seconds apart, same ₹2700 revenue — a card register typo (75 vs 78)
-- was just different enough that neither the exact-card check nor the
-- import's own near-duplicate guard caught it as the same person.
--
-- New check: same normalized name + same mobile, 2+ patient records —
-- a much stronger duplicate-PATIENT signal than a card-number match,
-- independent of whatever the card fields happen to say.
create or replace function public.data_quality_report()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'mobile', mobile, 'patient_code', patient_code,
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number
      )), '[]'::jsonb)
      from (
        select id, name, mobile, patient_code, card_series, card_register, card_number, created_at from patients
        where is_deleted = false and (name is null or trim(name) = '' or position(' ' in trim(name)) = 0)
        order by created_at desc
        limit 5000
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
               jsonb_agg(jsonb_build_object(
                 'id', id, 'name', name, 'patient_code', patient_code,
                 'card_series', card_series, 'card_register', card_register, 'card_number', card_number
               ) order by created_at) as members
        from patients
        where is_deleted = false and mobile is not null and trim(mobile) <> ''
        group by mobile
        having count(*) > 1
        order by count(*) desc
        limit 1000
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
        limit 5000
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
               jsonb_agg(jsonb_build_object(
                 'id', id, 'name', name, 'patient_code', patient_code,
                 'card_series', card_series, 'card_register', card_register, 'card_number', card_number
               ) order by created_at) as members
        from patients
        where is_deleted = false
          and card_series is not null and trim(card_series) <> ''
          and card_register is not null and trim(card_register) <> ''
          and card_number is not null and trim(card_number) <> ''
        group by card_series, card_register, card_number
        having count(*) > 1
        limit 1000
      ) d
    ),

    -- New (0075): same normalized name + mobile across 2+ records — a
    -- likely duplicate PATIENT (not just a duplicate card string), e.g.
    -- a card-register typo during import creating a second record for
    -- someone who already existed. Deliberately independent of the card
    -- fields, since the whole point is catching cases where the card
    -- numbers look different but it's the same real person.
    'possible_duplicate_patients', (
      select coalesce(jsonb_agg(jsonb_build_object('name', display_name, 'mobile', mobile, 'count', cnt, 'patients', members) order by cnt desc), '[]'::jsonb)
      from (
        select min(name) as display_name, mobile, count(*) cnt,
               jsonb_agg(jsonb_build_object(
                 'id', id, 'name', name, 'patient_code', patient_code,
                 'card_series', card_series, 'card_register', card_register, 'card_number', card_number
               ) order by created_at) as members
        from patients
        where is_deleted = false and mobile is not null and trim(mobile) <> '' and name is not null and trim(name) <> ''
        group by lower(trim(name)), mobile
        having count(*) > 1
        order by count(*) desc
        limit 1000
      ) pd
    ),
    'possible_duplicate_patients_total', (
      select count(*) from (
        select 1 from patients
        where is_deleted = false and mobile is not null and trim(mobile) <> '' and name is not null and trim(name) <> ''
        group by lower(trim(name)), mobile having count(*) > 1
      ) x
    ),

    'invalid_mobile', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'mobile', mobile, 'patient_code', patient_code,
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number
      )), '[]'::jsonb)
      from (
        select id, name, mobile, patient_code, card_series, card_register, card_number, created_at from patients
        where is_deleted = false and (mobile is null or trim(mobile) = '' or length(regexp_replace(mobile, '\D', '', 'g')) <> 10)
        order by created_at desc
        limit 5000
      ) t
    ),
    'invalid_mobile_total', (
      select count(*) from patients
      where is_deleted = false and (mobile is null or trim(mobile) = '' or length(regexp_replace(mobile, '\D', '', 'g')) <> 10)
    ),

    'invalid_email', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'email', email, 'patient_code', patient_code,
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number
      )), '[]'::jsonb)
      from (
        select id, name, email, patient_code, card_series, card_register, card_number, created_at from patients
        where is_deleted = false and email is not null and trim(email) <> '' and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        order by created_at desc
        limit 5000
      ) t
    ),
    'invalid_email_total', (
      select count(*) from patients
      where is_deleted = false and email is not null and trim(email) <> '' and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    ),

    'unconfirmed_numbers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'mobile', mobile, 'patient_code', patient_code,
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number,
        'mobile_confirmed', mobile_confirmed,
        'whatsapp_confirmed', whatsapp_confirmed,
        'has_distinct_whatsapp', (whatsapp_number is not null and trim(whatsapp_number) <> '')
      )), '[]'::jsonb)
      from (
        select id, name, mobile, patient_code, card_series, card_register, card_number,
               mobile_confirmed, whatsapp_confirmed, whatsapp_number, created_at
        from patients
        where is_deleted = false and (
          mobile_confirmed = false
          or (whatsapp_number is not null and trim(whatsapp_number) <> '' and whatsapp_confirmed = false)
        )
        order by created_at desc
        limit 5000
      ) t
    ),
    'unconfirmed_numbers_total', (
      select count(*) from patients
      where is_deleted = false and (
        mobile_confirmed = false
        or (whatsapp_number is not null and trim(whatsapp_number) <> '' and whatsapp_confirmed = false)
      )
    )
  ) into v_result;

  return v_result;
end;
$function$;

insert into schema_migrations (filename, notes) values
  ('0075_data_quality_possible_duplicate_patients', 'Adds possible_duplicate_patients to data_quality_report() — same normalized name+mobile across 2+ patient records, catches duplicate patients a card-number typo creates even when the exact card-triple check finds nothing (found live: Sulekha, mobile 7415582342, duplicated via a 75/78 card-register typo)')
on conflict (filename) do nothing;
