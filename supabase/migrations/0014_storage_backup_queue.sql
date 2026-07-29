-- ============================================================================
-- YHC-OS — Phase 1 item #15: Storage → Google Drive backup queue
--
-- case-photos and patient-documents (Supabase Storage buckets) were never
-- covered by the daily backup-to-sheets function -- Sheets can't hold
-- image files (size limits, and it's the wrong tool). Plan: sync these two
-- buckets to Google Drive instead, via a separate Edge Function.
--
-- Rather than having that function LIST both storage buckets every run
-- (recursive, one folder per patient/visit, gets slow and expensive at
-- scale), every successful upload now enqueues one row here at upload
-- time (see uploadCasePhoto / uploadPatientDocument in src/lib/db.ts).
-- The backup function just drains this queue -- small, incremental,
-- no bucket listing needed.
-- ============================================================================

create table if not exists storage_backup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  synced boolean not null default false,
  synced_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_storage_backup_queue_unsynced
  on storage_backup_queue(created_at)
  where synced = false;

-- VERIFY:
-- select bucket, count(*) filter (where synced) as synced, count(*) filter (where not synced) as pending
-- from storage_backup_queue group by bucket;
