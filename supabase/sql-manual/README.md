# Manual SQL (0023 onwards)

`supabase/migrations/` is now write-locked by the Lovable migration tooling,
which points at a different Supabase project than this app's real one
(`swekxnhvecrcpiuteqmj`). New SQL for the real project therefore lands here
instead, continuing the same numbering sequence as `supabase/migrations/`
(0001-0022).

Run these exactly like the earlier ones: paste into the Supabase SQL Editor
for `swekxnhvecrcpiuteqmj` and run. Read the header comment of each file
first — several require an Edge Function secret or a Vault entry to exist
before they will succeed.

## Files

- `0023_cron_function_secret.sql` — adds the `x-cron-secret` header to the
  five WhatsApp/health cron jobs so the Edge Functions they call can reject
  everyone else. Reads the secret from Vault so the value never lands in
  git. **Requires** `CRON_FUNCTION_SECRET` (Edge Function secret) and a
  Vault secret named `cron_function_secret` holding the same value.
- `0024_atomic_followup_reschedule.sql` — `reschedule_followups_atomic()`
  RPC: does the follow-up delete+insert (previously two separate,
  independently-racy client calls) inside one transaction, with the visit
  row locked against a concurrent retry. Fixes a duplicate-reminder bug.
- `0025_payment_idempotency_key.sql` — adds `idempotency_key` to `payments`
  (unique where not null) and an optional `p_idempotency_key` param to
  `collect_payment_atomic()`. The client sends one key per payment-screen
  visit, reused across retries of that submission; a repeat call with the
  same key returns the original result instead of inserting a second
  payment row. Closes the partial-payment double-submit gap (full payments
  were already accidentally protected by the existing DONE guard).
- `0026_patient_interactions.sql` — new `patient_interactions` table
  (Operational Manual Feature 2: call/verbal/WhatsApp/dose-change/query
  log, no visit required). Backs the Log Interaction button (Reception +
  Doctor) and the merged patient timeline.
- `0027_staged_followup_sequence.sql` — adds `channel` (CALL/WHATSAPP) to
  `followup_touchpoints` and `followups`, seeds the locked Day 0/2/5/9/
  14/19/25 escalation cadence (additive to the existing gap-bracket
  pre-due reminders, not a replacement), and updates
  `reschedule_followups_atomic` to carry channel through. Also fixed
  live: `followup_touchpoints` had 16 exact duplicate rows (every
  pre-due reminder was firing twice) — deduped before this ran.
