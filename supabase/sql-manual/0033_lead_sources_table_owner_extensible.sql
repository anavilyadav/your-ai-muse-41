-- 0033 — make lead sources Owner-extensible, no backend touch needed.
-- Already applied live via Supabase MCP on 06 Aug 2026 — this file is the
-- git record, no manual run needed.
--
-- Until now, valid lead_source values lived in a CHECK constraint —
-- extending the list (e.g. a new ad platform like IndiaMART/Sulekha) meant
-- someone had to write and apply a migration. Dr. Yadav asked for an
-- "Add More" option straight from Owner Settings instead.
--
-- Fix: move the vocabulary into a real table (lead_sources), and switch
-- leads.lead_source from a CHECK to a foreign key against it. Adding a row
-- to lead_sources from the Owner Control Centre UI IS the whole operation
-- from now on — no migration, no redeploy. external-lead-webhook now
-- validates against this same live table instead of a hardcoded list.

create table if not exists public.lead_sources (
  code text primary key,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.lead_sources (code, label) values
  ('WALK_IN', 'Walk-in'),
  ('JUSTDIAL', 'JustDial'),
  ('WHATSAPP', 'WhatsApp'),
  ('INSTAGRAM', 'Instagram'),
  ('FACEBOOK', 'Facebook'),
  ('GOOGLE', 'Google'),
  ('REFERRAL', 'Referral'),
  ('YOUTUBE', 'YouTube'),
  ('OTHER', 'Other')
on conflict (code) do nothing;

alter table public.leads drop constraint if exists leads_lead_source_check;
alter table public.leads add constraint leads_lead_source_fkey
  foreign key (lead_source) references public.lead_sources(code);
