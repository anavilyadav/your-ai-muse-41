-- 0065 — Raise Data Quality report row caps (22 Sep 2026)
--
-- 0061's per-category caps (500 rows, 200 groups) were sized for the old
-- 205-patient test database. Real data after the bulk import shows 1306
-- incomplete names alone — the Owner asked to review the FULL list, not
-- just the first 500, so a static export/list is actually usable. Raising
-- to comfortably cover real clinic scale for the foreseeable future.

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
               jsonb_agg(jsonb_build_object('id', id, 'name', name, 'patient_code', patient_code) order by created_at) as members
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
               jsonb_agg(jsonb_build_object('id', id, 'name', name, 'patient_code', patient_code) order by created_at) as members
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
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'mobile', mobile, 'patient_code', patient_code)), '[]'::jsonb)
      from (
        select id, name, mobile, patient_code, created_at from patients
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
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email, 'patient_code', patient_code)), '[]'::jsonb)
      from (
        select id, name, email, patient_code, created_at from patients
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
$$;

insert into schema_migrations (filename, notes) values
  ('0065_data_quality_report_higher_limits', 'Raises data_quality_report() per-category row caps from 500/200 to 5000/1000 so the Owner can review/export the full list at real clinic scale')
on conflict (filename) do nothing;
