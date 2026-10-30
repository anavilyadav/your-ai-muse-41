-- 0113 — payments may carry any Owner-managed payment mode (30 Oct 2026)
--
-- 0037 made payment modes Owner-managed (payment_modes: AY_PAYTM, YHC_PAYTM
-- ...) and collect_payment_atomic writes the chosen code (or SPLIT) into
-- payments.payment_mode — but the old CHECK still only allowed
-- CASH/UPI/CARD/ADVANCE/ADJUST, so collecting with AY PAYTM, YHC PAYTM or a
-- split failed. Reports read the breakdown from payment_splits, never from
-- this column, so any upper-case code is fine here.
alter table public.payments drop constraint if exists payments_payment_mode_check;
alter table public.payments add constraint payments_payment_mode_check
  check (payment_mode ~ '^[A-Z][A-Z0-9_]*$');

-- Dr. Yadav: "AY PAYTM UPI hai lekin wo alag account me hai to alag se mark
-- karte hai" — the daily sheet's AY PAYTM payments were imported as CASH
-- (the import knew only CASH/UPI/CARD). Mark them AY_PAYTM; mixed entries
-- ("cash, AY PAYTM") stay as they are.
create table if not exists public.dq_ay_paytm_backup as
  select now() as backed_up_at, p.id as payment_id, p.payment_mode as old_payment_mode
  from public.payments p where false;
insert into public.dq_ay_paytm_backup
  select now(), p.id, p.payment_mode from public.payments p
  where not p.is_deleted
    and upper(regexp_replace(trim(substring(p.notes from 'original mode: ([^|]*)')), '\s+', ' ', 'g')) = 'AY PAYTM';

update public.payments set payment_mode = 'AY_PAYTM'
  where id in (select payment_id from public.dq_ay_paytm_backup);
update public.payment_splits set mode = 'AY_PAYTM'
  where payment_id in (select payment_id from public.dq_ay_paytm_backup);

insert into schema_migrations (filename, notes) values
  ('0113_payment_mode_any_code', 'payments.payment_mode accepts any payment_modes code; AY PAYTM history marked AY_PAYTM')
on conflict (filename) do nothing;
