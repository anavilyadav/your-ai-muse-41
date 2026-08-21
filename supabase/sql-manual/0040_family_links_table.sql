-- ============================================================================
-- YHC-OS — Family linking: replace single family_group_id with a proper
-- pairwise link table (13 Aug 2026)
--
-- The old model gave every patient ONE family_group_id column, so a patient
-- could only ever belong to a single family group. Dr. Yadav pointed out
-- the real-world gap: a married patient is routinely linked to BOTH her
-- husband's family and her own parents' family, and neither the old model
-- nor a simple 1:1 link could represent that.
--
-- family_links is a plain pairwise table instead — any patient can have any
-- number of independent links to any number of other patients, each with
-- its own relationship label. patients.family_group_id/family_relationship
-- are left in place (unused, zero rows had data at time of this migration)
-- rather than dropped, since dropping columns is a one-way action and there
-- was no reason to take that risk for an already-empty pair of columns.
-- ============================================================================

create table if not exists public.family_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  related_patient_id uuid not null references public.patients(id) on delete cascade,
  relationship text not null,
  created_at timestamptz not null default now(),
  constraint family_links_no_self_link check (patient_id <> related_patient_id),
  constraint family_links_unique_pair unique (patient_id, related_patient_id)
);

create index if not exists idx_family_links_patient on public.family_links(patient_id);
create index if not exists idx_family_links_related on public.family_links(related_patient_id);

-- Matches every other table in this project — RLS is not enabled here
-- either, consistent with the current app-layer-only auth model. See the
-- separate, larger RLS remediation this project already has flagged.
grant select, insert, update, delete on public.family_links to authenticated;
