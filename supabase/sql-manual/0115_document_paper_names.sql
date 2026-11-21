-- 0115 — Uploaded papers get a date and a readable name (21 Nov 2026)
--
-- Dr. Yadav: case papers are uploaded at every visit, often 20–25 at once;
-- each must carry the date and a name that never mixes up, e.g.
-- "B-42-78 21/11/26 (1)", "B-42-78 21/11/26 (2)" …
--
-- paper_date  the visit / paper date the staff picked (default today in the app)
-- seq         1, 2, 3 … per patient per paper_date — given here, under a lock,
--             so two people uploading for the same patient never get the same
--             number and a second batch the same day carries on from the last
-- title       card + date + (seq), built from the patient's card at upload time
-- Rows uploaded before this (and payment screenshots) keep paper_date null and
-- show as before.

alter table public.patient_documents
  add column if not exists paper_date date,
  add column if not exists seq int,
  add column if not exists title text;

create index if not exists patient_documents_patient_paper_date_idx
  on public.patient_documents (patient_id, paper_date);

create or replace function public.patient_documents_name_paper()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_card text;
begin
  if new.paper_date is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('patient_documents:' || new.patient_id::text || ':' || new.paper_date::text));
  select coalesce(max(seq), 0) + 1 into new.seq
  from public.patient_documents
  where patient_id = new.patient_id and paper_date = new.paper_date;
  select coalesce(nullif(concat_ws('-', card_series, nullif(card_register, ''), card_number), ''),
                  replace(coalesce(patient_code, ''), 'YHC-', 'SYS-'))
    into v_card
  from public.patients where id = new.patient_id;
  new.title := trim(coalesce(v_card, '') || ' ' || to_char(new.paper_date, 'DD/MM/YY') || ' (' || new.seq || ')');
  return new;
end;
$function$;

drop trigger if exists trg_patient_documents_name_paper on public.patient_documents;
create trigger trg_patient_documents_name_paper
  before insert on public.patient_documents
  for each row execute function public.patient_documents_name_paper();

insert into schema_migrations (filename, notes) values
  ('0115_document_paper_names', 'patient_documents: paper_date + per-day seq + title "B-42-78 21/11/26 (1)"')
on conflict (filename) do nothing;

-- 0115b (same day, Dr. Yadav: "case paper, recase paper, payment screenshot, follow up paper
-- vagerah sab separate rahe hamesha naam ke saath"): each kind is named and numbered on its own —
-- "B-42-78 21/11/26 FOLLOW-UP (1)", "B-42-78 21/11/26 PAYMENT (1)". An upload without a picked
-- date (e.g. the Call Desk payment screenshot) takes today's IST date, so every new upload is named.
create or replace function public.patient_doc_kind_label(p_doc_type text)
returns text language sql immutable as $$
  select case p_doc_type
    when 'New Case Notes' then 'CASE PAPER'
    when 'Recase Paper' then 'RECASE'
    when 'Follow-up Notes' then 'FOLLOW-UP'
    when 'Lab Report' then 'REPORT'
    when 'Payment Screenshot' then 'PAYMENT'
    else 'OTHER' end
$$;

create or replace function public.patient_documents_name_paper()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_card text;
begin
  if new.paper_date is null then
    new.paper_date := (now() at time zone 'Asia/Kolkata')::date;
  end if;
  perform pg_advisory_xact_lock(hashtext('patient_documents:' || new.patient_id::text || ':' || new.paper_date::text || ':' || coalesce(new.doc_type, '')));
  select coalesce(max(seq), 0) + 1 into new.seq
  from public.patient_documents
  where patient_id = new.patient_id and paper_date = new.paper_date
    and public.patient_doc_kind_label(doc_type) = public.patient_doc_kind_label(new.doc_type);
  select coalesce(nullif(concat_ws('-', card_series, nullif(card_register, ''), card_number), ''),
                  replace(coalesce(patient_code, ''), 'YHC-', 'SYS-'))
    into v_card
  from public.patients where id = new.patient_id;
  new.title := trim(coalesce(v_card, '') || ' ' || to_char(new.paper_date, 'DD/MM/YY') || ' '
                    || public.patient_doc_kind_label(new.doc_type) || ' (' || new.seq || ')');
  return new;
end;
$function$;
