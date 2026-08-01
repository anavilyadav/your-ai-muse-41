-- 0018 — Settings UNIQUE key + lead source tracking
--
-- NOTE: run this on the clinic's own Supabase project
-- (https://swekxnhvecrcpiuteqmj.supabase.co) via the SQL editor, the same
-- way 0001–0017 were applied. The app code degrades gracefully until then:
-- upsertSetting() falls back to the old select-then-write path if the
-- unique constraint is missing, and lead_source writes are best-effort.
--
-- TASK 2: settings.key must be unique so upsert(onConflict:"key") is atomic.
-- Two Owner tabs saving the same Control Centre key used to race through a
-- non-atomic select-then-insert and silently create duplicate rows. Every
-- reader uses .maybeSingle(), so a duplicate makes those reads FAIL outright.
-- Dedupe first, keeping the most recently created row.
--
-- TASK 5: patients.lead_source records where a patient originally came from,
-- so the Owner can compare enquiry sources against actual converted patients.

-- 1) Dedupe settings on key: keep the newest row per key.
delete from public.settings s
using public.settings dup
where s.key = dup.key
  and s.id <> dup.id
  and (
    s.created_at < dup.created_at
    or (s.created_at = dup.created_at and s.id < dup.id)
  );

-- 2) Enforce uniqueness (idempotent — safe to re-run).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.settings'::regclass
      and conname = 'settings_key_unique'
  ) then
    alter table public.settings add constraint settings_key_unique unique (key);
  end if;
end $$;

-- 3) Lead source on patients.
alter table public.patients add column if not exists lead_source text;

create index if not exists patients_lead_source_idx on public.patients (lead_source);
create index if not exists leads_source_idx on public.leads (source);
