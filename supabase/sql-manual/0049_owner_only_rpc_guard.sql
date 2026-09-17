-- 0049 — Server-side Owner check on refund/merge RPCs (17 Sep 2026)
--
-- Found while verifying user's #9 request ("owner ya doctor jo prescribe
-- kr raha hai wohi bas" for discount/refund): resolve_payment_adjustment
-- and merge_patients_atomic were both Owner-only ONLY at the React UI
-- layer (AuthGate/isOwner). Neither RPC checked the caller's role itself.
--
-- After RLS Phase 1 (0043) granted `authenticated` full CRUD on
-- payment_adjustments (a rw_table) with a permissive USING(true) policy,
-- and resolve_payment_adjustment runs SECURITY INVOKER with EXECUTE
-- granted to `authenticated`, ANY logged-in staff member (Reception,
-- Doctor) could call supabase.rpc("resolve_payment_adjustment", ...)
-- directly and mark any pending adjustment REFUNDED or CREDIT_AVAILABLE
-- — completely bypassing the Owner-only screen. Confirmed live via
-- information_schema.routine_privileges: PUBLIC and anon also had a
-- stray EXECUTE grant (harmless today only because the underlying table
-- has no anon grant post-RLS, but still worth closing).
--
-- merge_patients_atomic is SECURITY DEFINER (correctly EXECUTE-granted to
-- authenticated/service_role only, no anon/PUBLIC) — but for the same
-- reason, DEFINER means it runs with the function owner's privileges
-- regardless of RLS, so any authenticated staff member could silently
-- merge/retire any two patient records right now, not just Owner.
--
-- Fix: both functions now look up the caller's role from public.users
-- (keyed by auth.uid(), the same pattern 0020's audit trigger already
-- uses) and raise an exception if it isn't OWNER. Table-level RLS is
-- deliberately not tightened further here (Phase 2 role-based row
-- restriction stays deferred, as previously decided) — this patches the
-- two RPCs that move real money or destructively rewrite patient history,
-- not general data access.

create or replace function resolve_payment_adjustment(
  p_adjustment_id uuid,
  p_method text,
  p_resolved_by text,
  p_notes text default null
) returns json as $$
declare
  v_role text;
  v_row payment_adjustments%rowtype;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can resolve payment adjustments';
  end if;

  if p_method not in ('REFUND', 'CREDIT_NOTE') then
    raise exception 'invalid method: %', p_method;
  end if;

  select * into v_row from payment_adjustments where id = p_adjustment_id for update;
  if not found then
    raise exception 'adjustment not found';
  end if;
  if v_row.status <> 'PENDING' then
    raise exception 'adjustment already resolved (status=%)', v_row.status;
  end if;

  update payment_adjustments
  set status = case when p_method = 'REFUND' then 'REFUNDED' else 'CREDIT_AVAILABLE' end,
      resolution_method = p_method,
      resolved_by = p_resolved_by,
      resolved_at = now(),
      notes = coalesce(p_notes, notes)
  where id = p_adjustment_id;

  return json_build_object('success', true, 'status', case when p_method = 'REFUND' then 'REFUNDED' else 'CREDIT_AVAILABLE' end);
end;
$$ language plpgsql set search_path to 'public';

revoke all on function resolve_payment_adjustment(uuid, text, text, text) from public, anon;
grant execute on function resolve_payment_adjustment(uuid, text, text, text) to authenticated, service_role;

revoke all on function apply_available_credit(uuid, uuid, numeric) from public, anon;
grant execute on function apply_available_credit(uuid, uuid, numeric) to authenticated, service_role;

revoke all on function revert_credit_application(uuid) from public, anon;
grant execute on function revert_credit_application(uuid) to authenticated, service_role;

create or replace function public.merge_patients_atomic(p_primary_id uuid, p_duplicate_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text;
  v_primary_exists boolean;
  v_duplicate_exists boolean;
  v_new_balance numeric;
  v_new_revenue numeric;
  v_new_visits int;
  v_last_visit date;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can merge patients';
  end if;

  if p_primary_id = p_duplicate_id then
    raise exception 'Same patient dono taraf chuna hai — alag patient select karo';
  end if;

  select exists(select 1 from patients where id = p_primary_id) into v_primary_exists;
  select exists(select 1 from patients where id = p_duplicate_id) into v_duplicate_exists;
  if not v_primary_exists or not v_duplicate_exists then
    raise exception 'Patient record nahi mila';
  end if;

  perform 1 from patients where id in (p_primary_id, p_duplicate_id) for update;

  update visits set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update prescriptions set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update payments set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update followups set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update appointments set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update deliveries set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update patient_documents set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update interactions set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update patient_interactions set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update holiday_greeting_log set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update birthday_greeting_log set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update anniversary_greeting_log set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update winback_log set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update payment_adjustments set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update whatsapp_log set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update wa_consent_log set patient_id = p_primary_id where patient_id = p_duplicate_id;
  update leads set referred_by_patient_id = p_primary_id where referred_by_patient_id = p_duplicate_id;
  update leads set converted_patient_id = p_primary_id where converted_patient_id = p_duplicate_id;

  delete from family_links
  where patient_id = p_duplicate_id
    and related_patient_id in (select related_patient_id from family_links where patient_id = p_primary_id);
  update family_links set patient_id = p_primary_id where patient_id = p_duplicate_id;

  delete from family_links
  where related_patient_id = p_duplicate_id
    and patient_id in (select patient_id from family_links where related_patient_id = p_primary_id);
  update family_links set related_patient_id = p_primary_id where related_patient_id = p_duplicate_id;

  delete from family_links where patient_id = related_patient_id;

  select count(*) into v_new_visits from visits where patient_id = p_primary_id;
  select coalesce(sum(balance_due),0) into v_new_balance from payments where patient_id = p_primary_id;
  select coalesce(sum(amount_received),0) into v_new_revenue from payments where patient_id = p_primary_id;
  select max(visit_date) into v_last_visit from visits where patient_id = p_primary_id;

  update patients
  set lifetime_visits = v_new_visits,
      lifetime_revenue = v_new_revenue,
      current_balance = v_new_balance,
      last_visit_date = v_last_visit
  where id = p_primary_id;

  update patients
  set is_deleted = true,
      notes = coalesce(notes || ' | ', '') || 'MERGED into ' || p_primary_id::text || ' on ' || now()::date
  where id = p_duplicate_id;

  return jsonb_build_object(
    'primary_id', p_primary_id,
    'duplicate_id', p_duplicate_id,
    'lifetime_visits', v_new_visits,
    'lifetime_revenue', v_new_revenue,
    'current_balance', v_new_balance
  );
end;
$function$;

revoke all on function merge_patients_atomic(uuid, uuid) from public, anon;
grant execute on function merge_patients_atomic(uuid, uuid) to authenticated, service_role;

-- Verify: exactly one overload per function, grants restricted as intended.
select p.routine_name, r.security_type, string_agg(p.grantee, ', ' order by p.grantee) as grantees
from information_schema.routine_privileges p
join information_schema.routines r on r.routine_name = p.routine_name and r.routine_schema = p.routine_schema
where p.routine_name in ('resolve_payment_adjustment','merge_patients_atomic','apply_available_credit','revert_credit_application')
  and p.routine_schema = 'public'
group by p.routine_name, r.security_type
order by p.routine_name;
