-- 0082 — Online Follow-up: support advance/partial payment (25 Sep 2026)
--
-- Dr. Yadav found live: the Confirm Payment step forced the confirmed
-- amount to be treated as BOTH charged and received (balance always 0) —
-- no way to record "patient paid an advance now, rest is due." Every other
-- payment path in this app (collect_payment_atomic, Delivery's own
-- advance_amount_paid) already separates "total agreed" from "actually
-- received" — this brings the online follow-up flow in line.
--
-- Signature changes (p_amount_confirmed -> p_amount_charged +
-- p_amount_received), so per this codebase's own established convention
-- (see 0037_split_payments.sql's comment on this exact footgun — Postgres
-- treats a changed parameter list as a NEW overload, not a replacement),
-- the old signature is dropped explicitly rather than relying on CREATE OR
-- REPLACE to swap it out.

drop function if exists confirm_online_followup_request_atomic(uuid, numeric, text, uuid, text);

create or replace function confirm_online_followup_request_atomic(
  p_request_id uuid,
  p_amount_charged numeric,
  p_amount_received numeric,
  p_payment_mode text,
  p_doc_id uuid,
  p_confirmed_by text
) returns jsonb as $$
declare
  v_status text;
  v_patient_id uuid;
  v_branch text;
  v_note text;
  v_delivery_method text;
  v_delivery_address_text text;
  v_token text;
  v_n int;
  v_visit_id uuid;
  v_payment_id uuid;
  v_delivery_id uuid;
  v_balance numeric;
  v_new_current_balance numeric;
  v_visit_date date := current_date;
begin
  if p_amount_charged is null or p_amount_charged <= 0 then
    raise exception 'Total amount zero ya khaali nahi ho sakta';
  end if;
  if p_amount_received is null or p_amount_received < 0 then
    raise exception 'Received amount galat hai';
  end if;
  if p_amount_received > p_amount_charged then
    raise exception 'Received amount (%) total amount (%) se zyada nahi ho sakta', p_amount_received, p_amount_charged;
  end if;

  select status, patient_id, branch, note, delivery_method, delivery_address_text
    into v_status, v_patient_id, v_branch, v_note, v_delivery_method, v_delivery_address_text
  from online_followup_requests
  where id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Request nahi mili';
  end if;
  if v_status <> 'AWAITING_PAYMENT' then
    raise exception 'Ye request already % ho chuki hai — dobara confirm nahi kar sakte', v_status;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch || v_visit_date::text));
  select count(*) into v_n from visits where visit_date = v_visit_date and branch = v_branch;
  v_token := 'T-' || lpad((v_n + 1)::text, 2, '0');

  insert into visits (patient_id, visit_date, visit_type, visit_status, token_number, branch, chief_complaint)
  values (v_patient_id, v_visit_date, 'VIDEO', 'REGISTERED', v_token, v_branch, v_note)
  returning id into v_visit_id;

  update patients
  set lifetime_visits = coalesce(lifetime_visits, 0) + 1
  where id = v_patient_id;

  update followups set status = 'DONE' where patient_id = v_patient_id and status = 'PENDING';

  v_balance := p_amount_charged - p_amount_received;

  insert into payments (visit_id, patient_id, amount_charged, amount_received, balance_due, payment_mode, branch, notes)
  values (v_visit_id, v_patient_id, p_amount_charged, p_amount_received, v_balance, p_payment_mode, v_branch, 'Online follow-up — payment screenshot confirmed')
  returning id into v_payment_id;

  if p_amount_received > 0 then
    insert into payment_splits (payment_id, mode, amount) values (v_payment_id, p_payment_mode, p_amount_received);
  end if;

  select coalesce(sum(balance_due), 0) into v_new_current_balance from payments where patient_id = v_patient_id;
  update patients
  set lifetime_revenue = coalesce(lifetime_revenue, 0) + p_amount_received,
      current_balance = v_new_current_balance
  where id = v_patient_id;

  if v_delivery_method in ('JAIPUR_COURIER', 'COURIER') then
    insert into deliveries (patient_id, visit_id, partner, address, advance_amount_paid, branch, status)
    values (v_patient_id, v_visit_id, 'Courier', v_delivery_address_text, p_amount_received, v_branch, 'Packed')
    returning id into v_delivery_id;
  end if;

  update online_followup_requests
  set status = 'CONFIRMED',
      visit_id = v_visit_id,
      delivery_id = v_delivery_id,
      confirmed_by = p_confirmed_by,
      confirmed_at = now(),
      amount_confirmed = p_amount_received,
      payment_screenshot_doc_id = p_doc_id
  where id = p_request_id;

  return jsonb_build_object('visit_id', v_visit_id, 'token_number', v_token, 'delivery_id', v_delivery_id, 'balance', v_balance);
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function confirm_online_followup_request_atomic(uuid, numeric, numeric, text, uuid, text) from public, anon;
grant execute on function confirm_online_followup_request_atomic(uuid, numeric, numeric, text, uuid, text) to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0082_online_followup_advance_payment', 'confirm_online_followup_request_atomic now takes separate p_amount_charged/p_amount_received (advance/partial payment support) instead of one p_amount_confirmed — old signature dropped, new one has 6 params')
on conflict (filename) do nothing;
