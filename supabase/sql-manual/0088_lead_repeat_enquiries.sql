-- 0088 — Record repeat JustDial enquiries instead of silently dropping them (16 Oct 2026)
--
-- Dr. Yadav: "TOTAL ROWS KA NUMBER 33290 HAI 31000 NAHI HAI JO REPEAT HAI
-- UNPE EK REPEAT KA BADGE LAGA DO LAKIN YE MENTION KRNA PEHLE KIS CHEEZ KE
-- LIYE SEARCH KIYA THA" — the sheet has ~33,290 rows but only ~31,048
-- became `leads` rows, because sync-justdial-leads dedupes by mobile
-- against leads+patients (correct — we don't want 5 duplicate lead cards
-- for one person who searched JustDial 5 times). The gap is exactly those
-- repeat searches, and until now they were dropped with zero record: no
-- way to tell staff "this person already searched for X before, now
-- they're searching for Y". This table captures every occurrence that
-- DOESN'T become its own lead row, so the repeat-enquiry badge
-- (fetchLeadRepeatInfo in db.ts) can show the full chronological history
-- by combining this table with the lead's own first-occurrence row.

create table if not exists public.lead_repeat_enquiries (
  id uuid primary key default gen_random_uuid(),
  mobile text not null,
  disease_interest text,
  source text not null default 'JUSTDIAL',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists lead_repeat_enquiries_mobile_idx on public.lead_repeat_enquiries (mobile);

alter table public.lead_repeat_enquiries enable row level security;

revoke all on public.lead_repeat_enquiries from public, anon;
grant select, insert, update, delete on public.lead_repeat_enquiries to authenticated;

drop policy if exists lead_repeat_enquiries_staff_all on public.lead_repeat_enquiries;
create policy lead_repeat_enquiries_staff_all on public.lead_repeat_enquiries for all to authenticated using (true) with check (true);

drop trigger if exists trg_audit_lead_repeat_enquiries on public.lead_repeat_enquiries;
create trigger trg_audit_lead_repeat_enquiries after insert or update or delete on public.lead_repeat_enquiries
  for each row execute function public.audit_log_generic();

insert into schema_migrations (filename, notes) values
  ('0088_lead_repeat_enquiries', 'Adds lead_repeat_enquiries — records every JustDial repeat-mobile search that sync-justdial-leads dedupes away, so the repeat-enquiry badge can show full history instead of only the first occurrence')
on conflict (filename) do nothing;
