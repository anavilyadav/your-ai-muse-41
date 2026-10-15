-- 0087 — Lead inbound-WhatsApp-reply handling (13 Oct 2026, Option B)
--
-- Dr. Yadav's ask: the 5-touch auto-sequence (0086) sends messages out,
-- but nothing in the system reacted when a lead actually REPLIED — it just
-- sat unread in WhatsApp until a staff member happened to check. This adds
-- the inbound half: a reply is classified, answered (within WhatsApp's
-- free 24h customer-service window), flagged for staff, and immediately
-- stops the automated outbound sequence for that lead.
--
-- last_inbound_at: set the instant any inbound message arrives — the
-- single signal lead-touch-sequencer checks (alongside call_count) to stop
-- blind automation the moment a real conversation has started.
-- last_inbound_text: the actual message they sent, for staff context (so
-- "what did they say" is visible in Lead CRM without opening WhatsApp).
-- inbound_flag: what aisensy-whatsapp-status's classifier decided —
-- 'BOOKING_INTENT' (wants to book — highest priority), 'NEEDS_HUMAN'
-- (didn't match a known pattern, or sounds clinical — never auto-answered
-- with anything beyond a generic ack), or 'INFO_ANSWERED' (a factual
-- FAQ — timing/address/fees — was auto-replied). Owner/staff clear it
-- manually once handled (there's no DB trigger that clears it — handling
-- is a human decision, not something to infer from other field changes).
alter table public.leads add column if not exists last_inbound_at timestamptz;
alter table public.leads add column if not exists last_inbound_text text;
alter table public.leads add column if not exists inbound_flag text check (inbound_flag in ('BOOKING_INTENT', 'NEEDS_HUMAN', 'INFO_ANSWERED'));

-- 3 new auto-reply campaigns, same disabled-by-default treatment as
-- migration 0086's LEAD_WELCOME/LEAD_TOUCH_2..5 — Owner turns each on from
-- Owner > WhatsApp once its AiSensy template is approved.
update public.settings
set value = jsonb_set(
  value::jsonb,
  '{modules}',
  (value::jsonb->'modules') || '{"LEAD_INFO_REPLY":{"enabled":false,"dailyCap":null},"LEAD_BOOKING_ACK":{"enabled":false,"dailyCap":null},"LEAD_GENERIC_ACK":{"enabled":false,"dailyCap":null}}'::jsonb
)::text
where key = 'whatsapp_controls';

insert into schema_migrations (filename, notes) values
  ('0087_lead_inbound_reply_handling', 'Adds leads.last_inbound_at/last_inbound_text/inbound_flag; registers LEAD_INFO_REPLY/LEAD_BOOKING_ACK/LEAD_GENERIC_ACK as disabled-by-default WhatsApp campaigns')
on conflict (filename) do nothing;
