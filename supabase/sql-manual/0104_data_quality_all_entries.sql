-- 0104 — Data Quality: purani entries ke checks wapas (28 Oct 2026)
--
-- 0103 let imported (old) entries pass every non-card check; Dr. Yadav: "ye
-- to kuch gadbad hua, bhot saare hi hat gaye". What he meant was only the
-- surname rule. So every check covers every patient again, except:
--  * Adhoora naam (no surname) stays removed.
--  * 1T..5T cards have no register by design (kept from 0103).

create or replace function public.data_quality_report()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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

    'incomplete_names', '[]'::jsonb,
    'incomplete_names_total', 0,

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
          case when trim(coalesce(card_series, '')) ~* '^[1-5]T$'
            then coalesce(trim(card_number), '') = ''
            else (coalesce(trim(card_series), '') <> '') <> (coalesce(trim(card_register), '') <> '')
              or (coalesce(trim(card_register), '') <> '') <> (coalesce(trim(card_number), '') <> '')
          end
        )
        order by created_at desc
        limit 5000
      ) t
    ),
    'partial_card_total', (
      select count(*) from patients
      where is_deleted = false and (
        case when trim(coalesce(card_series, '')) ~* '^[1-5]T$'
          then coalesce(trim(card_number), '') = ''
          else (coalesce(trim(card_series), '') <> '') <> (coalesce(trim(card_register), '') <> '')
            or (coalesce(trim(card_register), '') <> '') <> (coalesce(trim(card_number), '') <> '')
        end
      )
    ),

    'duplicate_cards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number,
        'count', cnt, 'patients', members
      ) order by cnt desc), '[]'::jsonb)
      from (
        select card_series, coalesce(card_register, '') as card_register, card_number, count(*) cnt,
               jsonb_agg(jsonb_build_object(
                 'id', id, 'name', name, 'patient_code', patient_code,
                 'card_series', card_series, 'card_register', card_register, 'card_number', card_number
               ) order by created_at) as members
        from patients
        where is_deleted = false
          and card_series is not null and trim(card_series) <> ''
          and card_number is not null and trim(card_number) <> ''
          and ((card_register is not null and trim(card_register) <> '') or trim(card_series) ~* '^[1-5]T$')
        group by card_series, coalesce(card_register, ''), card_number
        having count(*) > 1
        limit 1000
      ) d
    ),

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
        where is_deleted = false
          and (mobile is null or trim(mobile) = '' or length(regexp_replace(mobile, '\D', '', 'g')) <> 10)
        order by created_at desc
        limit 5000
      ) t
    ),
    'invalid_mobile_total', (
      select count(*) from patients
      where is_deleted = false
        and (mobile is null or trim(mobile) = '' or length(regexp_replace(mobile, '\D', '', 'g')) <> 10)
    ),

    'invalid_email', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'email', email, 'patient_code', patient_code,
        'card_series', card_series, 'card_register', card_register, 'card_number', card_number
      )), '[]'::jsonb)
      from (
        select id, name, email, patient_code, card_series, card_register, card_number, created_at from patients
        where is_deleted = false
          and email is not null and trim(email) <> '' and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        order by created_at desc
        limit 5000
      ) t
    ),
    'invalid_email_total', (
      select count(*) from patients
      where is_deleted = false
        and email is not null and trim(email) <> '' and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
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
  ('0104_data_quality_all_entries', 'data_quality_report: every check covers old entries again; only the surname check stays removed; 1T-5T cards need no register')
on conflict (filename) do nothing;
