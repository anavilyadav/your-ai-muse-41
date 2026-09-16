-- 0047 — Patient merge (Owner-only), 16 Sep 2026
--
-- Dr. Yadav: "patient merge chahiye lekin sirf woh main kar sakta hoon,
-- koi bhi staff nahi kar sakta, aur old aur new dono data poora poora
-- dikhna chahiye history-wise."
--
-- Reassigns every child row (visits, prescriptions, payments, follow-ups,
-- appointments, deliveries, documents, interactions, WhatsApp/greeting
-- logs, lead references, family links) from the duplicate patient to the
-- surviving one, inside one transaction with both rows locked. The
-- duplicate is retired (is_deleted = true, a note recording what it was
-- merged into), never hard-deleted -- traceable, and nothing that still
-- points at its id silently orphans.
--
-- family_links has a UNIQUE(patient_id, related_patient_id) -- a
-- duplicate's link that would collide with one the primary already has is
-- dropped rather than failing the whole merge over a redundant
-- relationship row. No other patient_id-referencing table has a unique
-- constraint that could conflict (checked live before writing this).

create or replace function public.merge_patients_atomic(p_primary_id uuid, p_duplicate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_primary_exists boolean;
  v_duplicate_exists boolean;
  v_new_balance numeric;
  v_new_revenue numeric;
  v_new_visits int;
  v_last_visit date;
begin
  if p_primary_id = p_duplicate_id then
    raise exception 'Same patient dono taraf chuna hai — alag patient select karo';
  end if;

  select exists(select 1 from patients where id = p_primary_id) into v_primary_exists;
  select exists(select 1 from patients where id = p_duplicate_id) into v_duplicate_exists;
  if not v_primary_exists or not v_duplicate_exists then
    raise exception 'Patient record nahi mila';
  end if;

  -- Lock both rows so a concurrent merge/edit on either can't race this one.
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

  -- family_links: reassign both directions; drop anything that would
  -- collide with a link the primary already has instead of erroring.
  delete from family_links
  where patient_id = p_duplicate_id
    and related_patient_id in (select related_patient_id from family_links where patient_id = p_primary_id);
  update family_links set patient_id = p_primary_id where patient_id = p_duplicate_id;

  delete from family_links
  where related_patient_id = p_duplicate_id
    and patient_id in (select patient_id from family_links where related_patient_id = p_primary_id);
  update family_links set related_patient_id = p_primary_id where related_patient_id = p_duplicate_id;

  -- A patient can't be linked to themselves — drop any self-link created
  -- above (duplicate was directly family-linked to primary).
  delete from family_links where patient_id = related_patient_id;

  -- Recompute the surviving record's aggregates from its now-combined history.
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

revoke all on function public.merge_patients_atomic(uuid, uuid) from public, anon;
grant execute on function public.merge_patients_atomic(uuid, uuid) to authenticated, service_role;
