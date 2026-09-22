-- 0067 — Fix doctor_totals the same way 0066 fixed owner_totals/week_revenue/
-- report_totals (22 Sep 2026)
--
-- Found while sweeping for other instances of the same bug after fixing
-- Owner's revenue totals: doctor_totals (powers the Doctor's own dashboard,
-- doctor.rx.dashboard.tsx) had the identical two bugs —
-- 'month_revenue' summed payments.created_at (import-insert timestamp)
-- instead of the linked visit's real visit_date, and 'today_new' counted
-- patients.created_at instead of each patient's earliest visit_date.

create or replace function public.doctor_totals(p_date date, p_month_start date, p_since date)
returns json
language sql
stable security definer
set search_path to 'public'
as $function$
  with complaints as (
    select lower(btrim(chief_complaint)) as k, count(*)::bigint as n
    from visits
    where visit_date >= p_month_start
      and chief_complaint is not null
      and btrim(chief_complaint) <> ''
    group by 1
    order by n desc
    limit 5
  ),
  month_pay as (
    select p.amount_received
    from payments p
    join visits v on v.id = p.visit_id
    where v.visit_date >= p_month_start and v.visit_date <= p_date
  ),
  first_visit as (
    select patient_id, min(visit_date) as first_date from visits group by patient_id
  )
  select json_build_object(
    'today_seen',           (select count(*) from visits where visit_date = p_date and visit_status = 'DONE'),
    'today_new',            (select count(*) from first_visit where first_date = p_date),
    'today_followups_done', (select count(*) from followups where status = 'DONE' and modified_at >= public.ist_day_start(p_date)),
    'month_patients',       (select count(distinct patient_id) from visits where visit_date >= p_month_start),
    'month_revenue',        coalesce((select sum(amount_received) from month_pay), 0),
    'awaiting_rx',          (select count(*) from visits where visit_status in ('WAITING_DOCTOR','CASE_TAKING','REGISTERED') and visit_date >= p_since),
    'top_complaints',       coalesce((select json_agg(json_build_object('label', k, 'count', n)) from complaints), '[]'::json)
  )
$function$;

insert into schema_migrations (filename, notes) values
  ('0067_fix_doctor_totals_dates', 'Fixes doctor_totals (Doctor dashboard) month_revenue/today_new to use the linked visit''s real visit_date instead of payments.created_at / patients.created_at — same root cause and fix as 0066''s owner_totals/report_totals/week_revenue')
on conflict (filename) do nothing;
