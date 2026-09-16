-- 0046 — Cancel phantom follow-ups created by the payment-at-registration bug
--
-- collectPayment() scheduled a full follow-up sequence any time a payment
-- reached balance zero, which was safe back when a full payment could only
-- happen AFTER a real consultation. Once inline payment-at-registration
-- shipped, a payment collected at registration time also hits balance
-- zero, but the visit's own status correctly stays REGISTERED (0044) since
-- no doctor has seen the patient yet. The follow-up trigger was never
-- updated to check that, so ~200 test registrations with payment collected
-- up front (never consulted, no prescription, no medicine given) each
-- generated a full staged follow-up sequence.
--
-- Damage found live: 520 follow-up rows across 52 distinct patients whose
-- visit was still REGISTERED with no case_discussed_at. 95 of those had
-- already sent a real WhatsApp follow-up reminder before this was caught.
--
-- Code fix: src/lib/db.ts collectPayment() now gates on
-- data.visit_status === 'DONE' (the RPC's own report of whether the visit
-- had already left REGISTERED before this payment), not on balance alone.
--
-- This migration cancels every still-pending phantom row so no further
-- messages go out. Rows already sent cannot be unsent — that's the 95 real
-- WhatsApp messages that already reached patients before this was caught.
-- SKIP is used, not DELETE, so the record of what happened (and why)
-- stays visible rather than disappearing from the table.

update followups f
set status = 'SKIP'
from visits v
where v.id = f.visit_id
  and v.visit_status = 'REGISTERED'
  and v.case_discussed_at is null
  and f.status = 'PENDING';
