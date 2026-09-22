-- 0066 — Fix revenue/report totals using payment insert-time instead of
-- real visit date (22 Sep 2026)
--
-- Owner reported "Today's Revenue" showing ₹157.8L (the ENTIRE bulk
-- import's total) and the week/month/report breakdowns not respecting
-- real per-day/per-month history, even though every imported visit
-- correctly carries its real historical visit_date. Root cause: three
-- report RPCs (owner_totals, week_revenue, report_totals) filtered
-- `payments` by `payments.created_at` — the row-INSERT timestamp — not by
-- the visit it belongs to. For live, same-day usage created_at and the
-- visit's real date are the same thing, so this never showed up before;
-- every bulk-imported payment's created_at is "whenever the import ran"
-- (today), regardless of how old the real visit was, so every period
-- filter that includes today swept in the entire historical total.
--
-- Fix: join payments -> visits and filter on visits.visit_date instead.
-- Also redefines "new patients" the same way — a patient's earliest
-- visit_date, not patients.created_at (which has the identical
-- import-timestamp problem: every bulk-imported patient's created_at is
-- also "today", so "New Today"/"New Patients" was equally inflated).

create or replace function public.owner_totals(p_date date, p_month_start date)
returns json
language sql
stable security definer
set search_path to 'public'
as $function$
  with today_pay as (
    select v.branch, p.amount_received
    from payments p
    join visits v on v.id = p.visit_id
    where v.visit_date = p_date
  ),
  month_pay as (
    select p.id, v.branch, p.amount_received
    from payments p
    join visits v on v.id = p.visit_id
    where v.visit_date >= p_month_start and v.visit_date <= p_date
  ),
  month_modes as (
    select s.mode, sum(s.amount)::numeric as amount
    from payment_splits s
    join month_pay mp on mp.id = s.payment_id
    group by s.mode
  ),
  first_visit as (
    select patient_id, min(visit_date) as first_date from visits group by patient_id
  )
  select json_build_object(
    'today_visits_bajaj',     (select count(*) from visits where visit_date = p_date and branch = 'BAJAJ_NAGAR'),
    'today_visits_jagatpura', (select count(*) from visits where visit_date = p_date and branch = 'JAGATPURA'),
    'today_revenue',            coalesce((select sum(amount_received) from today_pay), 0),
    'today_revenue_bajaj',      coalesce((select sum(amount_received) from today_pay where branch = 'BAJAJ_NAGAR'), 0),
    'today_revenue_jagatpura',  coalesce((select sum(amount_received) from today_pay where branch = 'JAGATPURA'), 0),
    'month_revenue',            coalesce((select sum(amount_received) from month_pay), 0),
    'new_today',       (select count(*) from first_visit where first_date = p_date),
    'followups_today', (select count(*) from followups where status = 'PENDING' and due_date <= p_date),
    'by_mode',         coalesce((select json_agg(json_build_object('mode', mode, 'amount', amount)) from month_modes), '[]'::json)
  )
$function$;

create or replace function public.week_revenue(p_start date, p_end date)
returns table(day date, total numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  select d::date as day,
         coalesce((
           select sum(p.amount_received)
           from payments p
           join visits v on v.id = p.visit_id
           where v.visit_date = d::date
         ), 0)::numeric as total
  from generate_series(p_start, p_end, interval '1 day') d
$function$;

create or replace function public.report_totals(p_start date, p_end date, p_branch text default null::text)
returns json
language sql
stable security definer
set search_path to 'public'
as $function$
  with pay as (
    select p.id, p.amount_received, p.balance_due
    from payments p
    join visits v on v.id = p.visit_id
    where v.visit_date >= p_start
      and v.visit_date <= p_end
      and (p_branch is null or v.branch = p_branch)
  ),
  vis as (
    select distinct v.patient_id
    from visits v
    where v.visit_date >= p_start
      and v.visit_date <= p_end
      and (p_branch is null or v.branch = p_branch)
  ),
  first_visit as (
    select patient_id, min(visit_date) as first_date from visits group by patient_id
  ),
  pat as (
    select count(*)::bigint as c
    from patients pt
    join first_visit fv on fv.patient_id = pt.id
    where fv.first_date >= p_start
      and fv.first_date <= p_end
      and (p_branch is null or pt.branch = p_branch)
  ),
  lead as (
    select count(*)::bigint as c
    from leads l
    where l.status = 'CONVERTED'
      and l.created_at >= public.ist_day_start(p_start)
      and l.created_at <= public.ist_day_end(p_end)
  ),
  modes as (
    select s.mode, sum(s.amount)::numeric as amount
    from payment_splits s
    join pay on pay.id = s.payment_id
    group by s.mode
  )
  select json_build_object(
    'total_revenue',   coalesce((select sum(amount_received) from pay), 0),
    'outstanding',     coalesce((select sum(balance_due)     from pay), 0),
    'total_patients',  (select count(*) from vis),
    'new_patients',    (select c from pat),
    'leads_converted', (select c from lead),
    'by_mode',         coalesce((select json_agg(json_build_object('mode', mode, 'amount', amount)) from modes), '[]'::json)
  )
$function$;

insert into schema_migrations (filename, notes) values
  ('0066_fix_revenue_report_dates', 'Fixes owner_totals/week_revenue/report_totals to filter payments by the linked visit''s real visit_date instead of payments.created_at (the import-insert timestamp), and redefines "new patients" as a patient''s earliest visit_date instead of patients.created_at, for the same reason')
on conflict (filename) do nothing;
