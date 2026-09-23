-- 0072 — Fix "Leads Converted" report figure using created_at instead of
-- actual conversion time (23 Sep 2026)
--
-- Full-project audit found: report_totals() (fixed for payments/patients
-- in migration 0066) still filters "leads converted" by leads.created_at
-- — the lead's row-creation time, not when it actually converted.
-- autoConvertMatchingLead() only ever updated status/converted_patient_id,
-- never a timestamp, and leads had no converted_at column at all. A lead
-- created in August that converts into a real patient in November would
-- never show up in November's report — only ever in August's, which by
-- then is a closed, already-reported period. Currently dormant (0 of the
-- live leads have status='CONVERTED' yet) but it's the identical bug
-- class as the payments.created_at issue, just not yet triggered.

alter table public.leads
  add column if not exists converted_at timestamptz;

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
      and l.converted_at >= public.ist_day_start(p_start)
      and l.converted_at <= public.ist_day_end(p_end)
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
  ('0072_leads_converted_at', 'Adds leads.converted_at (set by autoConvertMatchingLead on the app side) and fixes report_totals() to filter leads_converted by it instead of leads.created_at — same date-source bug class as 0066/0067')
on conflict (filename) do nothing;
