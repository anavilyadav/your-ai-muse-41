-- 0083 — "Possible duplicate" must check card number, not just name+mobile
-- (25 Sep 2026, Dr. Yadav)
--
-- "Humne adhura naam wale patients ko sirf surname nahi hone ki wajah se
-- rok rakha hai lakin card number to alag honge hi na" — the
-- possible_duplicate_patients category (data_quality_report) grouped
-- purely by lower(trim(name)) + mobile, so two DIFFERENT real patients
-- who happen to share a first name (adhoora naam — no surname yet) and a
-- household mobile got flagged as a possible duplicate needing a manual
-- merge review — even when their card numbers (the real, physical
-- identifier — see displayPatientCode) already prove they're different
-- people. The live "Sulekha" example: same name, same mobile, but card
-- A-75-20 vs A-78-20 — clearly two different patients, not a duplicate.
--
-- Fix: only flag a name+mobile group as a possible duplicate when it's
-- still genuinely ambiguous — i.e. NOT every member already has a
-- distinct, fully-filled-in card number. A group with two blank-card
-- members, or two members sharing the same card number (a real data
-- error), still gets flagged; a group where cards are already distinct
-- and complete does not — that's just an incomplete-name coincidence,
-- which the per-patient "incomplete name" flag already covers on its own.

create or replace function data_quality_report()
returns jsonb as $$
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

    -- Card-aware now (0083) — see migration header comment.
    'possible_duplicate_patients', (
      select coalesce(jsonb_agg(jsonb_build_object('name', display_name, 'mobile', mobile, 'count', cnt, 'patients', members) order by cnt desc), '[]'::jsonb)
      from (
        select min(name) as display_name, mobile, count(*) cnt,
               jsonb_agg(jsonb_build_object(
                 'id', id, 'name', name, 'patient_code', patient_code,
                 'card_series', card_series, 'card_register', card_register, 'card_number', card_number
               ) order by created_at) as members
        from (
          select *,
            case
              when coalesce(trim(card_series), '') <> '' and coalesce(trim(card_register), '') <> '' and coalesce(trim(card_number), '') <> ''
              then card_series || '-' || card_register || '-' || card_number
              else null
            end as card_key
          from patients
          where is_deleted = false and mobile is not null and trim(mobile) <> '' and name is not null and trim(name) <> ''
        ) x
        group by lower(trim(name)), mobile
        -- Genuinely ambiguous only: at least one member has no card yet,
        -- or two members share the same card (a real data error). A
        -- group where every member already has a distinct, complete card
        -- is not a duplicate — count(distinct card_key) excludes NULLs,
        -- so it's strictly less than count(*) in both flag-worthy cases.
        having count(*) > 1 and count(*) > count(distinct card_key)
        order by count(*) desc
        limit 1000
      ) pd
    ),
    'possible_duplicate_patients_total', (
      select count(*) from (
        select 1
        from (
          select *,
            case
              when coalesce(trim(card_series), '') <> '' and coalesce(trim(card_register), '') <> '' and coalesce(trim(card_number), '') <> ''
              then card_series || '-' || card_register || '-' || card_number
              else null
            end as card_key
          from patients
          where is_deleted = false and mobile is not null and trim(mobile) <> '' and name is not null and trim(name) <> ''
        ) x
        group by lower(trim(name)), mobile
        having count(*) > 1 and count(*) > count(distinct card_key)
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
$$ language plpgsql security definer set search_path to 'public';

insert into schema_migrations (filename, notes) values
  ('0083_fix_possible_duplicate_card_check', 'data_quality_report()''s possible_duplicate_patients now excludes name+mobile groups where every member already has a distinct, complete card number — those are different real patients (incomplete-name coincidence), not a merge candidate')
on conflict (filename) do nothing;
