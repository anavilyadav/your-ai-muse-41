-- 0112 — a patient's earlier card numbers (30 Oct 2026)
--
-- Dr. Yadav: every 7-8 years the physical records are cleared and a patient
-- gets a NEW card (Priyank A-57-39 -> B-05-79, Sulekha A-78-20 / A-75-20 ->
-- B-81-14). The card_series/register/number columns hold the current card;
-- old_cards keeps the earlier ones ("A-57-39") so search still finds the
-- patient by any card ever written on their papers.
alter table public.patients add column if not exists old_cards text[] not null default '{}';
create index if not exists patients_old_cards_gin on public.patients using gin (old_cards);

insert into schema_migrations (filename, notes) values
  ('0112_patient_old_cards', 'patients.old_cards text[] — earlier card numbers after re-numbering, searchable')
on conflict (filename) do nothing;
