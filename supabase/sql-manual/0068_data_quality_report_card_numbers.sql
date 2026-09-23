-- 0068 — Data Quality report: show the real card number, not patient_code
-- (23 Sep 2026)
--
-- Owner reported the "Adhoora naam" / "Ek mobile number, kai patients"
-- sections show the app's own internal YHC-XXXX patient_code, which is
-- useless for cross-checking against the physical card register — they
-- need the real SERIES-REGISTER-NUMBER card to go open the actual paper
-- book. data_quality_report() already returned card_series/register/
-- number for the two sections that are specifically ABOUT card numbers
-- (partial_card, duplicate_cards) but not for incomplete_names,
-- shared_mobiles, invalid_mobile or invalid_email — adding it there too.

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
    )
  ) into v_result;

  return v_result;
end;
$function$;

insert into schema_migrations (filename, notes) values
  ('0068_data_quality_report_card_numbers', 'Adds card_series/card_register/card_number to every patient reference data_quality_report() returns, so the Data Quality page can show the real physical card number instead of only the internal YHC-XXXX code')
on conflict (filename) do nothing;
