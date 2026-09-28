-- 0085 — Expected revenue from pending follow-ups (25 Sep 2026, Dr. Yadav)
--
-- "Rohit 30 din ki dawai lekar gaya, 2500 diye, ek mahine baad aayega to
-- 2500 honge... Abhishek ek mahine ki leke gaya lekin agle mahine aaya
-- nahi to mujhe dikhaye ki ye follow-up nahi aaya hai, aur itna total
-- loss ho raha hai." — the follow-up system (generateFollowupSchedule)
-- already schedules a due_date per visit based on next_visit_date, but
-- never connected it back to money: no way to see "if these pending
-- follow-ups actually come back, how much revenue is that" or "how much
-- did NOT coming back already cost us."
--
-- Expected amount per follow-up = the SUM of amount_charged across every
-- payment on the ORIGINATING visit (followups.visit_id) — the agreed
-- price for that round of medicine, the same number the patient would
-- plausibly pay again on a like-for-like follow-up. Exact aggregate RPC
-- (not derived from the follow-up list, which is capped) — same
-- "counts/sums must be exact, never list-derived" rule this file's own
-- fetchFollowups() already established for due/overdue counts.
create or replace function followup_revenue_forecast()
returns jsonb as $$
declare
  v_today date := current_date;
  v_result jsonb;
begin
  select jsonb_build_object(
    'due_soon_count', count(*) filter (where f.due_date >= v_today),
    'due_soon_amount', coalesce(sum(vp.amount) filter (where f.due_date >= v_today), 0),
    'overdue_count', count(*) filter (where f.due_date < v_today),
    'overdue_amount', coalesce(sum(vp.amount) filter (where f.due_date < v_today), 0)
  )
  into v_result
  from followups f
  left join lateral (
    select coalesce(sum(amount_charged), 0) as amount
    from payments
    where payments.visit_id = f.visit_id
  ) vp on true
  where f.status = 'PENDING' and f.is_deleted = false;

  return v_result;
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function followup_revenue_forecast() from public, anon;
grant execute on function followup_revenue_forecast() to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0085_followup_revenue_forecast', 'followup_revenue_forecast() RPC — exact due-soon vs overdue expected-revenue sums for the Follow-up Calls screen, based on each pending follow-up''s originating visit payment total')
on conflict (filename) do nothing;
