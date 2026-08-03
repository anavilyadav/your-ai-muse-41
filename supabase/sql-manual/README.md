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
