-- 0045 — Push report aggregation into Postgres
--
-- WHY THIS EXISTS
-- fetchReports / fetchOwnerStats / fetchDoctorDashboard / fetchWeekRevenue
-- all pulled raw payment + visit rows into the browser and summed them with
-- .reduce(). PostgREST caps a response at its max-rows setting, so past that
-- many rows in a period the browser summed a TRUNCATED set: the reported
-- revenue came back looking perfectly normal, just wrong and always LOW.
-- A silently under-reported revenue figure is the worst class of bug in this
-- app, so the arithmetic moves to where all the rows actually are.
--
-- Every function below is STABLE + SECURITY DEFINER with a pinned search_path,
-- returns only aggregates (never patient rows), and is granted to
-- `authenticated` only — never `anon` (see 0029 / 0043).
--
-- IST NOTE: payments.created_at is timestamptz; every boundary below is built
-- with an explicit +05:30 offset, matching istDayStart/istDayEnd in db.ts.
-- Comparing against a bare date would silently shift the 12:00am–5:30am IST
-- window into the previous day.

-- ---------------------------------------------------------------- helpers
create or replace function public.ist_day_start(p_date date)
returns timestamptz language sql immutable as $$
  select (p_date::text || ' 00:00:00+05:30')::timestamptz
$$;

create or replace function public.ist_day_end(p_date date)
returns timestamptz language sql immutable as $$
  select (p_date::text || ' 23:59:59.999+05:30')::timestamptz
$$;

-- ------------------------------------------------------------ report_totals
-- One row of aggregates for an arbitrary IST calendar range, optionally
-- scoped to one branch. by_mode reads payment_splits (0037) so a payment
-- split across modes lands in each mode's own bucket.
create or replace function public.report_totals(
  p_start date,
  p_end   date,
  p_branch text default null
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with pay as (
    select p.id, p.amount_received, p.balance_due
    from payments p
    where p.created_at >= public.ist_day_start(p_start)
      and p.created_at <= public.ist_day_end(p_end)
      and (p_branch is null or p.branch = p_branch)
  ),
  vis as (
    select distinct v.patient_id
    from visits v
    where v.visit_date >= p_start
      and v.visit_date <= p_end
      and (p_branch is null or v.branch = p_branch)
  ),
  pat as (
    select count(*)::bigint as c
    from patients pt
    where pt.created_at >= public.ist_day_start(p_start)
      and pt.created_at <= public.ist_day_end(p_end)
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
$$;

-- ------------------------------------------------------------- owner_totals
create or replace function public.owner_totals(
  p_date date,
  p_month_start date
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with today_pay as (
    select branch, amount_received
    from payments
    where created_at >= public.ist_day_start(p_date)
      and created_at <= public.ist_day_end(p_date)
  ),
  month_pay as (
    select id, amount_received
    from payments
    where created_at >= public.ist_day_start(p_month_start)
      and created_at <= public.ist_day_end(p_date)
  ),
  month_modes as (
    select s.mode, sum(s.amount)::numeric as amount
    from payment_splits s
    join month_pay mp on mp.id = s.payment_id
    group by s.mode
  )
  select json_build_object(
    'today_visits_bajaj',     (select count(*) from visits where visit_date = p_date and branch = 'BAJAJ_NAGAR'),
    'today_visits_jagatpura', (select count(*) from visits where visit_date = p_date and branch = 'JAGATPURA'),
    'today_revenue',            coalesce((select sum(amount_received) from today_pay), 0),
    'today_revenue_bajaj',      coalesce((select sum(amount_received) from today_pay where branch = 'BAJAJ_NAGAR'), 0),
    'today_revenue_jagatpura',  coalesce((select sum(amount_received) from today_pay where branch = 'JAGATPURA'), 0),
    'month_revenue',            coalesce((select sum(amount_received) from month_pay), 0),
    'new_today',       (select count(*) from patients where created_at >= public.ist_day_start(p_date) and created_at <= public.ist_day_end(p_date)),
    'followups_today', (select count(*) from followups where status = 'PENDING' and due_date <= p_date),
    'by_mode',         coalesce((select json_agg(json_build_object('mode', mode, 'amount', amount)) from month_modes), '[]'::json)
  )
$$;

-- ------------------------------------------------------------ doctor_totals
create or replace function public.doctor_totals(
  p_date date,
  p_month_start date,
  p_since date
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with complaints as (
    select lower(btrim(chief_complaint)) as k, count(*)::bigint as n
    from visits
    where visit_date >= p_month_start
      and chief_complaint is not null
      and btrim(chief_complaint) <> ''
    group by 1
    order by n desc
    limit 5
  )
  select json_build_object(
    'today_seen',           (select count(*) from visits where visit_date = p_date and visit_status = 'DONE'),
    'today_new',            (select count(*) from patients where created_at >= public.ist_day_start(p_date) and created_at <= public.ist_day_end(p_date)),
    'today_followups_done', (select count(*) from followups where status = 'DONE' and updated_at >= public.ist_day_start(p_date)),
    'month_patients',       (select count(distinct patient_id) from visits where visit_date >= p_month_start),
    'month_revenue',        coalesce((select sum(amount_received) from payments where created_at >= public.ist_day_start(p_month_start)), 0),
    'awaiting_rx',          (select count(*) from visits where visit_status in ('WAITING_DOCTOR','CASE_TAKING','REGISTERED') and visit_date >= p_since),
    'top_complaints',       coalesce((select json_agg(json_build_object('label', k, 'count', n)) from complaints), '[]'::json)
  )
$$;

-- -------------------------------------------------------------- week_revenue
-- One row per IST calendar day, gap-filled so a zero-revenue day is still a
-- point on the chart rather than a missing bar.
create or replace function public.week_revenue(p_start date, p_end date)
returns table (day date, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select d::date as day,
         coalesce((
           select sum(p.amount_received)
           from payments p
           where p.created_at >= public.ist_day_start(d::date)
             and p.created_at <= public.ist_day_end(d::date)
         ), 0)::numeric as total
  from generate_series(p_start, p_end, interval '1 day') d
$$;

-- ------------------------------------------------------------------- grants
-- Reports are staff-only. Deliberately no `anon` grant: these functions are
-- SECURITY DEFINER and would otherwise hand clinic revenue to the public key.
revoke all on function public.ist_day_start(date)              from public, anon;
revoke all on function public.ist_day_end(date)                from public, anon;
revoke all on function public.report_totals(date, date, text)  from public, anon;
revoke all on function public.owner_totals(date, date)         from public, anon;
revoke all on function public.doctor_totals(date, date, date)  from public, anon;
revoke all on function public.week_revenue(date, date)         from public, anon;

grant execute on function public.ist_day_start(date)             to authenticated, service_role;
grant execute on function public.ist_day_end(date)               to authenticated, service_role;
grant execute on function public.report_totals(date, date, text) to authenticated, service_role;
grant execute on function public.owner_totals(date, date)        to authenticated, service_role;
grant execute on function public.doctor_totals(date, date, date) to authenticated, service_role;
grant execute on function public.week_revenue(date, date)        to authenticated, service_role;

-- Indexes the aggregates lean on. Cheap, and they also help the existing
-- row-level reads that stay in place as the fallback path.
create index if not exists idx_payments_created_at on public.payments (created_at);
create index if not exists idx_payments_branch_created_at on public.payments (branch, created_at);
create index if not exists idx_visits_visit_date on public.visits (visit_date);
create index if not exists idx_visits_branch_visit_date on public.visits (branch, visit_date);
create index if not exists idx_patients_created_at on public.patients (created_at);
create index if not exists idx_payment_splits_payment_id on public.payment_splits (payment_id);
