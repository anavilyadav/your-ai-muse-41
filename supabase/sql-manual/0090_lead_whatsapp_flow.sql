-- 0090 — Button-driven lead WhatsApp flow (19 Oct 2026)
--
-- Dr. Yadav finalised the pain-first lead flow (welcome per category →
-- symptom → duration → treatment → how to consult, plus 3 no-reply
-- follow-ups). Every send now goes through one edge function,
-- lead-flow-send; aisensy-whatsapp-status routes each button tap to the
-- next message and records the answers here.

alter table public.leads add column if not exists pain_profile jsonb;
alter table public.leads add column if not exists wa_welcome_sent_at timestamptz;

-- Follow-ups (din 2/5/10) only ever go to leads whose welcome really went
-- out — never to the 31k leads imported before the flow existed.
create index if not exists leads_wa_welcome_sent_at_idx on public.leads (wa_welcome_sent_at) where wa_welcome_sent_at is not null;

-- One switch per AiSensy template, all OFF until that template is approved.
update public.settings
set value = jsonb_set(
  value::jsonb,
  '{modules}',
  (value::jsonb -> 'modules') || (
    select coalesce(jsonb_object_agg(name, jsonb_build_object('enabled', false, 'dailyCap', null)), '{}'::jsonb)
    from unnest(array[
      'LEAD_WELCOME_NERVOUS','LEAD_WELCOME_SKIN','LEAD_WELCOME_CHILDREN','LEAD_WELCOME_DIGESTIVE',
      'LEAD_WELCOME_RESPIRATORY','LEAD_WELCOME_HOMEOPATHY_DIRECT','LEAD_WELCOME_MEN','LEAD_WELCOME_RENAL',
      'LEAD_WELCOME_JOINT_BONE','LEAD_WELCOME_CANCER','LEAD_WELCOME_GENERAL',
      'LEAD_STEP_DURATION','LEAD_STEP_TREATMENT','LEAD_STEP_CONSULT',
      'LEAD_REPLY_CLINIC','LEAD_REPLY_VIDEO','LEAD_REPLY_DELIVERY','LEAD_REPLY_CALL',
      'LEAD_REPLY_FEES','LEAD_REPLY_TYPED','LEAD_REPLY_STOP',
      'LEAD_NUDGE_1','LEAD_NUDGE_2','LEAD_NUDGE_3'
    ]) as name
    where not ((value::jsonb -> 'modules') ? name)
  ),
  true
)::text
where key = 'whatsapp_controls';

-- Public files WhatsApp fetches by URL (welcome photo, category PDFs).
-- Nothing patient-related goes here.
insert into storage.buckets (id, name, public)
values ('public-media', 'public-media', true)
on conflict (id) do nothing;

drop policy if exists public_media_staff_insert on storage.objects;
create policy public_media_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media');
drop policy if exists public_media_staff_update on storage.objects;
create policy public_media_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'public-media') with check (bucket_id = 'public-media');
drop policy if exists public_media_staff_delete on storage.objects;
create policy public_media_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-media');

insert into schema_migrations (filename, notes) values
  ('0090_lead_whatsapp_flow', 'leads.pain_profile + wa_welcome_sent_at; 24 lead-flow WhatsApp modules registered OFF; public-media storage bucket for welcome photo / category PDFs')
on conflict (filename) do nothing;
