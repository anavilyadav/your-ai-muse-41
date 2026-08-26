# YHC-OS — Post-Sync Hardening (All Four Areas)

## Step 0 — Sync first (blocking, you do this)

This workspace is on `3f1be63`; GitHub `main` is on `bea668a` — **42 commits ahead**. Anything I write before syncing would revert Claude's latest work (split payments, medicine master, lead webhooks, idempotency, security hardening).

So: sync the Lovable project to the latest GitHub `main`, then tell me. I will re-verify the head commit before touching a single file.

Everything below is written against `origin/main` as it actually is today — the already-fixed items (atomic follow-up reschedule 0024, payment idempotency 0025, signed-URL-only photos, degraded-mode banner, RPC anon revoke 0029) are **not** re-done.

---

## Area 1 — Tests for the new code (largest gap)

~6,400 new lines landed with zero new tests. Same 5 test files as before.

- **Split payments** (`0037`): multi-mode payment totals, partial + credit combinations, rounding, revenue split per mode.
- **Payment idempotency** (`0025`): same key twice returns one charge; the trailing-param gap path raises a degraded alert instead of double-charging.
- **Atomic follow-up reschedule** (`0024`): no duplicate PENDING rows on re-run; RPC-missing fallback still raises the degraded alert.
- **Medicine master** (`0028`) + dispensing: stock decrement, out-of-stock block, unit conversion.
- **Lead webhooks** (`meta-leadgen`, `external-lead`, `justdial`): signature rejection, duplicate-lead handling, malformed payload.
- **Payment-status guard** (`0041`): a REGISTERED visit cannot be marked paid out of order.
- **Card number series** (`0036`) and **family links** (`0040`): uniqueness under concurrent inserts.

Coverage floor in CI raised from its current effective 7% in two steps, so the build stays green while the suite fills in.

**Done when:** the new-feature suites pass and deliberately breaking the split-payment total turns CI red.

---

## Area 2 — Table-level RLS rollout

`0029` locked down function EXECUTE grants, but only `0028_medicine_master.sql` enables row-level security on a table. `patients`, `visits`, `payments`, `prescriptions`, `followups`, `leads`, `documents` and the log tables have none — the anon key reaches every row.

Approach, in one migration per group so each can be verified before the next:

1. **Staff-only core** (`patients`, `visits`, `payments`, `prescriptions`, `followups`, `case_papers`): `ENABLE RLS`, explicit `GRANT` to `authenticated`, no `anon` grant, policies scoped to a signed-in staff session.
2. **Role-restricted** (`payment_adjustments`, `audit_log`, `system_alerts`, `whatsapp_log`): read limited to OWNER via a security-definer role check; writes service-role only.
3. **Service-role-only** (`storage_backup_queue`, cron log tables): revoke `anon`/`authenticated` entirely.
4. Storage buckets: confirm `case-photos` and `patient-documents` are Private and add `storage.objects` policies matching the same rule.

Each step verified with `has_table_privilege` (not `information_schema` — that's the exact trap `0029` documents), plus a read attempt with the anon key that must fail.

**Risk note:** RLS is the one change that can lock out the live clinic. Every group gets an app-side smoke pass (register → token → case → Rx → dispense → pay) before the next group goes in.

---

## Area 3 — Error-vs-empty + loading states

- 27 `if (error) return []` sites in `db.ts` change to a discriminated result so a permission/network failure renders "couldn't load — retry" instead of an empty list. Callers updated screen by screen.
- `owner/audit-log` and `owner/health` get `isLoading` / `isError` branches (currently neither has any).
- Pharmacy prescriptions query and Lead "Convert" / row-delete buttons get busy guards so a double-tap can't fire twice.
- Icon-only close/delete buttons get `aria-label` (only 9 files have any today).
- One language applied consistently — 96 Hinglish toast lines currently sit next to English chrome. **I'll use Hinglish everywhere**, since that's what reception staff read; say the word if you want English instead.

---

## Area 4 — Reports at scale

10 client-side `.reduce()` aggregations remain, each behind a row `.limit()` — meaning at clinic volume the totals go *silently wrong*, not slow.

- Postgres aggregate RPCs for `fetchReports` (day/week/month/year/custom range), `fetchOwnerStats`, `fetchDoctorDashboard`, `fetchWeekRevenue`, with branch and date-range parameters pushed into SQL.
- `runHealthChecks` counts cached.
- The 31 `select("*")` reads narrowed to the columns actually rendered, so clinical notes stop shipping to screens that don't show them.
- Tablet layout between 430px and 1024px.

**Done when:** reports return in constant time regardless of volume, and a month with more rows than the old limit shows the correct total.

---

## Order and technical notes

Area 1 → Area 3 → Area 4 → Area 2 last. Tests first so every later change is auto-rechecked; RLS last because it's the only irreversible-feeling one and it benefits from the test suite existing.

- New SQL lands as `0043+` in `supabase/sql-manual/`, same as 0024–0042, for you to run.
- Areas 1, 3 and 4 need no database access at all.
- I re-verify the head commit at the start of each block so a repeat of the 42-commit drift is caught immediately, not four blocks later.
