-- 0030 — Lead CRM top-level upgrade
-- Already applied live via Supabase MCP on 06 Aug 2026 — this file is the
-- git record, no manual run needed (see sql-manual/README.md for why this
-- folder exists instead of supabase/migrations/).
--
-- Context: app code was writing leads.status values ("Cold"/"HOT"/"Converted")
-- that don't match the live CHECK constraint on leads.status
-- ('NEW','CONTACTED','APPOINTMENT_FIXED','CONVERTED','LOST','NURTURING'),
-- so every insert (manual add, bulk import, JustDial webhook, auto-convert-
-- on-registration) had been silently failing — live leads table had 0 rows.
-- This migration only extends what the schema allows; the actual value-fix
-- is in the app code (db.ts) and the JustDial edge function, same commit.

-- 1) Add GOOGLE as a valid lead source (Google Search/Maps/Ads enquiries) —
--    was in the old app's source list but never in the DB constraint.
alter table public.leads drop constraint if exists leads_lead_source_check;
alter table public.leads add constraint leads_lead_source_check
  check (lead_source = ANY (ARRAY['WALK_IN','JUSTDIAL','WHATSAPP','INSTAGRAM','FACEBOOK','GOOGLE','REFERRAL','YOUTUBE','OTHER']));

-- 2) Referral tracking — "Referral" source needs to record WHO referred,
--    for thank-you follow-ups and future incentive tracking. Nullable,
--    only set when lead_source = 'REFERRAL'.
alter table public.leads add column if not exists referred_by_patient_id uuid references public.patients(id);

-- 3) disease_interest already existed but had no index — filtered on for
--    source-wise + disease-wise reporting, cheap to add now.
create index if not exists leads_disease_interest_idx on public.leads (disease_interest);

-- 4) assigned_to + next_followup weren't previously queried — index for the
--    "my assigned leads with a follow-up due" screen.
create index if not exists leads_assigned_followup_idx on public.leads (assigned_to, next_followup);
