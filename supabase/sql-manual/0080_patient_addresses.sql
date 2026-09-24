-- 0080 — Multiple saved delivery addresses per patient (24 Sep 2026)
--
-- Dr. Yadav: "HAR PATIENT KA FULL ADDRESS BHI ADD KRNA HAI TAKI COURIER
-- KE KAAM AAYEGA... OR MULTIPLE ADDRESS CHAIYE KYUKI ALAG ALAG JAGAH
-- MANGWATE HAI PATIENTS" — online-bundle patients often want medicine
-- couriered to a different place each time (home vs office vs native
-- village). The existing patients.address/city/pincode stay as the
-- single general profile address (used at registration, profile
-- display); this is a separate one-to-many table specifically for
-- courier delivery targets, editable from the patient's profile.

create table if not exists public.patient_addresses (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  label text not null default 'Ghar',
  address text not null,
  city text,
  pincode text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists patient_addresses_patient_id_idx on public.patient_addresses (patient_id);

-- RLS Phase 1 pattern (see 0043_rls_core_phase1.sql) — close anon off
-- entirely, full CRUD for any signed-in staff member.
alter table public.patient_addresses enable row level security;

revoke all on public.patient_addresses from public, anon;
grant select, insert, update, delete on public.patient_addresses to authenticated;

drop policy if exists patient_addresses_staff_all on public.patient_addresses;
create policy patient_addresses_staff_all on public.patient_addresses for all to authenticated using (true) with check (true);

drop trigger if exists trg_audit_patient_addresses on public.patient_addresses;
create trigger trg_audit_patient_addresses after insert or update or delete on public.patient_addresses
  for each row execute function public.audit_log_generic();

insert into schema_migrations (filename, notes) values
  ('0080_patient_addresses', 'Adds patient_addresses table — multiple labelled delivery addresses per patient (Ghar/Office/Other), editable from Patient Profile, selectable when creating a Delivery order')
on conflict (filename) do nothing;
