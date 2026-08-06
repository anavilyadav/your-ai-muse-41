-- 0032 — two independent things, bundled because the second depends on the first working.
-- Already applied live via Supabase MCP on 06 Aug 2026 — this file is the
-- git record, no manual run needed.

-- PART A: fix — settings.category is NOT NULL with no default, so
-- upsertSetting() (used by every Owner Control Centre toggle) has been
-- throwing on any BRAND-NEW key. Confirmed live: 'justdial_webhook_enabled'
-- had never actually been written, despite that toggle existing in the UI
-- since 29 Jul — its default-ON fallback in the frontend was masking this.
-- A DB-level default is the most robust fix: works for every future new
-- setting key, not just the two below, without touching upsertSetting().
alter table public.settings alter column category set default 'GENERAL';

-- PART B: website/FB/Insta auto-capture support.
-- source_ref: optional external identifier (which form, which ad
-- campaign/page) so Owner can tell WHICH website form or WHICH ad brought
-- a lead later, not just "Google" or "Facebook" in general.
alter table public.leads add column if not exists source_ref text;

-- Master on/off toggles for the two new webhooks (external-lead-webhook,
-- meta-leadgen-webhook), defaulted ON — harmless until each is actually
-- connected to a real source.
insert into public.settings (key, value, category) values
  ('external_lead_webhook_enabled', 'true', 'AUTOMATION'),
  ('meta_leadgen_enabled', 'true', 'AUTOMATION')
on conflict (key) do nothing;
