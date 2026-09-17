-- 0048 — WhatsApp delivery/read tracking, 17 Sep 2026
--
-- Dr. Yadav: "kya yeh possible hai AiSensy se read report update hoti
-- rahe aur mujhe mere patient profile mein bhi dikh jaye ki iske
-- WhatsApp number pe fail hote hain messages?"
--
-- whatsapp_log today only ever records the SEND attempt's outcome
-- (sent/failed/skipped_*) -- nothing tells you whether a "sent" message
-- actually reached the phone or was read. AiSensy pushes that as a
-- separate webhook event (Meta's standard WhatsApp Cloud API status
-- callback format), keyed by the outbound message's own id ("wamid...").
--
-- IMPORTANT: `status` is NOT overwritten by delivery events. It stays
-- exactly what it's meant since day one -- did the send API call itself
-- succeed -- because checkCampaignGate's daily-cap counting filters on
-- status = 'sent'. If a later "delivered" webhook silently flipped that
-- to something else, the cap counter would under-count today's sends.
-- Delivery/read/failure-after-send are new, separate columns instead.

alter table public.whatsapp_log
  add column if not exists message_id text,
  add column if not exists provider_response jsonb,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists delivery_failed_at timestamptz,
  add column if not exists delivery_failed_reason text;

create index if not exists idx_whatsapp_log_message_id on public.whatsapp_log (message_id) where message_id is not null;
