-- 0019 — WhatsApp delivery log + consent-change history
--
-- Phase 3 decision (29 Jul 2026, item 26): WhatsApp Delivery Dashboard —
-- "Sent/failed/opt-out track karega." Audit found the underlying data
-- didn't exist to build that dashboard on: only successful cron sends
-- were logged (into the generic `interactions` table — no campaign or
-- status column), failures were counted in-memory and lost on every
-- request, ad-hoc sends (send-whatsapp — Registration/Appointment
-- confirms) weren't logged at all, and consent changes had no history.
--
-- NOTE: run this on the clinic's own Supabase project
-- (https://swekxnhvecrcpiuteqmj.supabase.co) via the SQL editor, the same
-- way 0001-0018 were applied.

-- 1) One structured row per WhatsApp send attempt (success or failure).
create table if not exists public.whatsapp_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  campaign_name text not null,
  destination text,
  status text not null check (status in ('sent', 'failed', 'skipped_consent')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_log_created_at_idx on public.whatsapp_log (created_at desc);
create index if not exists whatsapp_log_campaign_idx on public.whatsapp_log (campaign_name);
create index if not exists whatsapp_log_status_idx on public.whatsapp_log (status);
create index if not exists whatsapp_log_patient_idx on public.whatsapp_log (patient_id);

-- 2) Consent-change history via trigger (not app-code), so it's captured
-- no matter which screen — present or future — flips wa_consent. Same
-- "real enforcement, not UI-only" pattern already used for Hidden
-- Identity Mode elsewhere in this project.
create table if not exists public.wa_consent_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  old_value boolean,
  new_value boolean not null,
  changed_at timestamptz not null default now()
);

create index if not exists wa_consent_log_patient_idx on public.wa_consent_log (patient_id);
create index if not exists wa_consent_log_changed_at_idx on public.wa_consent_log (changed_at desc);

create or replace function public.log_wa_consent_change()
returns trigger
language plpgsql
as $$
begin
  if old.wa_consent is distinct from new.wa_consent then
    insert into public.wa_consent_log (patient_id, old_value, new_value)
    values (new.id, old.wa_consent, new.wa_consent);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wa_consent_change on public.patients;
create trigger trg_wa_consent_change
  after update on public.patients
  for each row
  execute function public.log_wa_consent_change();
