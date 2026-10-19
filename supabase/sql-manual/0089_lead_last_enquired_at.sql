-- 0089 — leads.last_enquired_at: when this person last searched (19 Oct 2026)
--
-- Dr. Yadav wants a repeat search to be noticed the moment it happens. The
-- Lead CRM list was ordered by created_at (the FIRST search), so someone
-- searching again today stayed buried at their months-old position. This
-- column tracks the latest search; the list sorts on it. Kept current by
-- triggers so every lead source and every repeat path updates it.

alter table public.leads add column if not exists last_enquired_at timestamptz;

-- One-time backfill of every row: not a staff edit, so keep it out of the
-- audit log (31k audit rows otherwise).
alter table public.leads disable trigger trg_audit_leads;
update public.leads l
set last_enquired_at = greatest(
  l.created_at,
  coalesce((select max(r.occurred_at) from public.lead_repeat_enquiries r where r.mobile = l.mobile), l.created_at)
)
where l.last_enquired_at is null;
alter table public.leads enable trigger trg_audit_leads;

alter table public.leads alter column last_enquired_at set not null;

create index if not exists leads_last_enquired_at_idx on public.leads (last_enquired_at desc);

create or replace function public.leads_set_last_enquired_at()
returns trigger language plpgsql as $$
begin
  if new.last_enquired_at is null then
    new.last_enquired_at := coalesce(new.created_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_leads_last_enquired_at on public.leads;
create trigger trg_leads_last_enquired_at before insert on public.leads
  for each row execute function public.leads_set_last_enquired_at();

create or replace function public.lead_repeat_bump_last_enquired()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.leads
  set last_enquired_at = new.occurred_at
  where mobile = new.mobile and last_enquired_at < new.occurred_at;
  return new;
end $$;

revoke all on function public.lead_repeat_bump_last_enquired() from public, anon;

drop trigger if exists trg_lead_repeat_bump on public.lead_repeat_enquiries;
create trigger trg_lead_repeat_bump after insert on public.lead_repeat_enquiries
  for each row execute function public.lead_repeat_bump_last_enquired();

insert into schema_migrations (filename, notes) values
  ('0089_lead_last_enquired_at', 'Adds leads.last_enquired_at (latest search, incl. repeats) kept current by triggers; Lead CRM list sorts on it so a repeat search surfaces at the top')
on conflict (filename) do nothing;
