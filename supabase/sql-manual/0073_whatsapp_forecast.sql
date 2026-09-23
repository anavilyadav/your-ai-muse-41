-- 0073 — WhatsApp send forecast (23 Sep 2026)
--
-- Owner wants to see, before turning WhatsApp back on, exactly how many
-- messages would go out each day (today/tomorrow/day-after/...), broken
-- down by which campaign, with the ability to open each and see the real
-- patient list — since the real system is due-date driven, this forecast
-- mirrors each campaign's actual send-eligibility logic (the same logic
-- living in each cron edge function) against LIVE data, read-only, so
-- nothing is guessed.
--
-- Only forecasts the due-date-driven campaigns: FOLLOWUP_REMINDER,
-- WINBACK, HOLIDAY_GREETING, birthday_wish, anniversary_wish.
-- REGISTRATION_CONFIRM / APPOINTMENT_REMINDER / delivery_update are
-- triggered by a staff action that hasn't happened yet (a new
-- registration, a new appointment, a delivery status change) — there is
-- no due date to forecast from, so they're intentionally left out.

create or replace function public.whatsapp_forecast(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_result jsonb;
  v_days date[];
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can view the WhatsApp forecast';
  end if;

  select array_agg((current_date + i)::date order by i)
    into v_days
    from generate_series(0, greatest(0, p_days - 1)) as i;

  with days as (
    select (current_date + i)::date as d, i as day_index
    from generate_series(0, greatest(0, p_days - 1)) as i
  ),

  -- ---- FOLLOWUP_REMINDER ----
  -- Day 0 = the real backlog the cron would clear today (due_date <= today).
  -- Day N>=1 = due_date exactly on that day (today's backlog is assumed
  -- cleared by then — a forecast, not a guarantee if WhatsApp stays off
  -- or a cap is hit).
  followup_candidates as (
    select f.id as followup_id, f.patient_id, f.due_date, p.name, p.mobile, p.patient_code
    from followups f
    join patients p on p.id = f.patient_id
    where f.status = 'PENDING' and f.channel = 'WHATSAPP' and f.reminder_sent_at is null
      and p.wa_consent = true and p.is_deleted = false
  ),
  followup_by_day as (
    select d.d, d.day_index, fc.patient_id, fc.name, fc.mobile, fc.patient_code
    from days d
    join followup_candidates fc
      on (d.day_index = 0 and fc.due_date <= d.d)
      or (d.day_index > 0 and fc.due_date = d.d)
  ),

  -- ---- WINBACK ----
  -- Day 0 = real backlog per tier (last_visit_date <= cutoff, not yet sent
  -- that tier). Day N>=1 = patients newly crossing a tier's threshold
  -- exactly that day.
  active_tiers as (select id, label, days_lapsed from winback_tiers where active = true),
  winback_candidates as (
    select p.id as patient_id, p.name, p.mobile, p.patient_code, p.last_visit_date, t.days_lapsed, t.id as tier_id
    from patients p
    cross join active_tiers t
    where p.wa_consent = true and p.is_deleted = false and p.last_visit_date is not null
      and not exists (
        select 1 from winback_log wl where wl.patient_id = p.id and wl.tier_days = t.days_lapsed
      )
  ),
  winback_by_day as (
    select d.d, d.day_index, wc.patient_id, wc.name, wc.mobile, wc.patient_code
    from days d
    join winback_candidates wc
      on (d.day_index = 0 and wc.last_visit_date <= (d.d - wc.days_lapsed))
      or (d.day_index > 0 and wc.last_visit_date = (d.d - wc.days_lapsed))
  ),

  -- ---- HOLIDAY_GREETING ----
  holiday_by_day as (
    select d.d, d.day_index, p.id as patient_id, p.name, p.mobile, p.patient_code
    from days d
    join holidays h on h.date = d.d and h.active = true
    join patients p on p.wa_consent = true and p.is_deleted = false
    where not exists (
      select 1 from holiday_greeting_log hgl where hgl.patient_id = p.id and hgl.holiday_id = h.id
    )
  ),

  -- ---- birthday_wish / anniversary_wish ----
  birthday_by_day as (
    select d.d, d.day_index, p.id as patient_id, p.name, p.mobile, p.patient_code
    from days d
    join patients p on p.wa_consent = true and p.is_deleted = false and p.dob is not null
      and to_char(p.dob, 'MM-DD') = to_char(d.d, 'MM-DD')
    where not exists (
      select 1 from birthday_greeting_log bgl where bgl.patient_id = p.id and bgl.year = extract(year from d.d)::int
    )
  ),
  anniversary_by_day as (
    select d.d, d.day_index, p.id as patient_id, p.name, p.mobile, p.patient_code
    from days d
    join patients p on p.wa_consent = true and p.is_deleted = false and p.anniversary_date is not null
      and to_char(p.anniversary_date, 'MM-DD') = to_char(d.d, 'MM-DD')
    where not exists (
      select 1 from anniversary_greeting_log agl where agl.patient_id = p.id and agl.year = extract(year from d.d)::int
    )
  ),

  -- Fold one campaign's per-day rows into the {key, per_day:[{date,count,patients}]} shape.
  campaign_json as (
    select 'FOLLOWUP_REMINDER' as key, jsonb_agg(jsonb_build_object(
      'date', sub.d, 'count', sub.cnt,
      'patients', sub.patients
    ) order by sub.d) as per_day
    from (
      select d.d, d.day_index, count(fb.patient_id) as cnt,
        coalesce(jsonb_agg(jsonb_build_object('id', fb.patient_id, 'name', fb.name, 'mobile', fb.mobile, 'patient_code', fb.patient_code) order by fb.name)
          filter (where fb.patient_id is not null), '[]'::jsonb) as patients
      from days d
      left join followup_by_day fb on fb.d = d.d
      group by d.d, d.day_index
    ) sub

    union all

    select 'WINBACK', jsonb_agg(jsonb_build_object(
      'date', sub.d, 'count', sub.cnt, 'patients', sub.patients
    ) order by sub.d)
    from (
      select d.d, d.day_index, count(wb.patient_id) as cnt,
        coalesce(jsonb_agg(jsonb_build_object('id', wb.patient_id, 'name', wb.name, 'mobile', wb.mobile, 'patient_code', wb.patient_code) order by wb.name)
          filter (where wb.patient_id is not null), '[]'::jsonb) as patients
      from days d
      left join winback_by_day wb on wb.d = d.d
      group by d.d, d.day_index
    ) sub

    union all

    select 'HOLIDAY_GREETING', jsonb_agg(jsonb_build_object(
      'date', sub.d, 'count', sub.cnt, 'patients', sub.patients
    ) order by sub.d)
    from (
      select d.d, d.day_index, count(hb.patient_id) as cnt,
        coalesce(jsonb_agg(jsonb_build_object('id', hb.patient_id, 'name', hb.name, 'mobile', hb.mobile, 'patient_code', hb.patient_code) order by hb.name)
          filter (where hb.patient_id is not null), '[]'::jsonb) as patients
      from days d
      left join holiday_by_day hb on hb.d = d.d
      group by d.d, d.day_index
    ) sub

    union all

    select 'birthday_wish', jsonb_agg(jsonb_build_object(
      'date', sub.d, 'count', sub.cnt, 'patients', sub.patients
    ) order by sub.d)
    from (
      select d.d, d.day_index, count(bb.patient_id) as cnt,
        coalesce(jsonb_agg(jsonb_build_object('id', bb.patient_id, 'name', bb.name, 'mobile', bb.mobile, 'patient_code', bb.patient_code) order by bb.name)
          filter (where bb.patient_id is not null), '[]'::jsonb) as patients
      from days d
      left join birthday_by_day bb on bb.d = d.d
      group by d.d, d.day_index
    ) sub

    union all

    select 'anniversary_wish', jsonb_agg(jsonb_build_object(
      'date', sub.d, 'count', sub.cnt, 'patients', sub.patients
    ) order by sub.d)
    from (
      select d.d, d.day_index, count(ab.patient_id) as cnt,
        coalesce(jsonb_agg(jsonb_build_object('id', ab.patient_id, 'name', ab.name, 'mobile', ab.mobile, 'patient_code', ab.patient_code) order by ab.name)
          filter (where ab.patient_id is not null), '[]'::jsonb) as patients
      from days d
      left join anniversary_by_day ab on ab.d = d.d
      group by d.d, d.day_index
    ) sub
  )

  select jsonb_build_object(
    'generated_at', now(),
    'days', to_jsonb(v_days),
    'campaigns', coalesce(jsonb_agg(jsonb_build_object('key', cj.key, 'per_day', cj.per_day)), '[]'::jsonb)
  ) into v_result
  from campaign_json cj;

  return v_result;
end;
$function$;

insert into schema_migrations (filename, notes) values
  ('0073_whatsapp_forecast', 'Adds whatsapp_forecast(p_days) RPC — per-day, per-campaign send forecast (FOLLOWUP_REMINDER, WINBACK, HOLIDAY_GREETING, birthday_wish, anniversary_wish) with the real eligible patient list per cell, mirroring each cron function''s actual send-eligibility logic against live data')
on conflict (filename) do nothing;
