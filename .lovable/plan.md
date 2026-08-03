# YHC-OS Hardening — 4 Blocks, In Order

Based on the 03 Aug audit. Each block ends with a verifiable check. No feature work, no UI redesign.

---

## Block 1 — Testing + CI (first, so everything after is auto-rechecked)

**Test infrastructure**
- Add `@vitest/coverage-v8`, `msw`, `jsdom`, `@testing-library/react`.
- Split `vitest.config.ts` into two projects: `node` (pure logic) and `jsdom` (components).
- Add a Supabase mock factory so `db.ts` functions can be tested without touching the live clinic database.

**Test suites (highest-risk first)**
1. IST boundaries — `istNow`, `today`, `istDayStart/End/Of`, `istWeekday` at 23:55 UTC, 00:05 UTC, 00:30 IST, month/year edges.
2. Money — fee-master resolution per visit type, fee-rule accumulation incl. negative and ONLINE override, payment/credit/overpay math, revenue split rounding.
3. Concurrency + fallback — RPC-missing path activates, degraded alert fires, token/patient-code duplication under simultaneous calls, stock lost-update.
4. Guards — dispense blocked outside PHARMACY stage, payment blocked on DONE visit, lockout threshold and unlock.
5. Component smoke tests for the payment, dispense and Rx screens (render, error state, submit-disabled-while-saving).

**CI**
- `package.json`: `typecheck`, `lint`, `test`, `test:coverage`, and a combined `ci` script.
- `.github/workflows/ci.yml` running `ci` on every push and PR, with a coverage floor.

**Done when:** CI is green on a push and deliberately breaking an IST helper turns it red.

---

## Block 2 — Security, mechanical part

- **`send-whatsapp`**: add OPTIONS/CORS and require a caller check (Supabase JWT for app calls, shared secret for server calls). Currently unauthenticated spend endpoint.
- **`create-staff-login`**: add OPTIONS/CORS so browser invocation doesn't fail preflight.
- **Cron endpoints** (`whatsapp-winback`, `whatsapp-holiday-greetings`, `whatsapp-birthday-anniversary`, `nightly-data-health`): add an `x-cron-secret` constant-time check in each function plus a migration updating the pg_cron `net.http_post` headers, matching the pattern already used by `backup-to-sheets`.
- **Patient documents / medical photos**: switch from public URLs to short-lived signed URLs at every read site.
- **Secrets in SQL**: replace `PASTE_YOUR_SECRET_HERE` in 0002 and 0015 with a documented `vault`/settings read so the migrations are safely re-runnable.
- **Schema into git**: dump the live schema (tables, functions, triggers, cron jobs, grants) into `0000_bootstrap.sql`, plus migrations for the currently-untracked tables (`birthday_greeting_log`, `anniversary_greeting_log`, `holiday_greeting_log`, `winback_log`, `winback_tiers`, `holidays`) and the missing `register_patient_with_visit` RPC.

**Note:** full RLS rollout stays deferred by your earlier decision. Everything above is the non-RLS half and is safe to ship without touching row access.

**Done when:** every function rejects an unauthenticated call, photos load only via signed URLs, and a fresh database can be rebuilt from `supabase/migrations` alone.

---

## Block 3 — Data integrity (+ one real-scenario test round)

- **Fail loudly instead of silently**: every RPC-missing fallback that reintroduces a race (`nextPatientCode`, `nextTokenForToday`, check-in, registration, prescription, `addStockEntry`) either throws a clear operator-visible error or shows a persistent degraded-mode banner — no more invisible degradation.
- **`markDispensed` fallback**: remove it. It skips inventory decrement; better to block dispensing than silently corrupt stock.
- **`collectPayment`**: keep fail-closed, but add a clear operator message naming the missing RPC instead of a raw error.
- **Follow-up scheduling**: move delete-then-insert into a single atomic RPC; stop continuing after a failed delete.
- **Error-vs-empty**: `fetchOutstandingPatients`, `fetchSystemAlerts`, `fetchAvailableCredit`, `fetchFeeMaster` and the other `catch → []` functions surface a real error state instead of looking empty.
- **`whatsapp-daily-reminders`**: apply the IST offset the other three crons already have.
- **`updatePatientContactInfo`**: call the existing duplicate-mobile guard.
- **Idempotency key on payment collection** so a double-tap cannot double-charge.
- **Delete `src/lib/yhc-store.ts`** (dead demo store shadowing real type names).
- **Real-scenario round**: seeded dummy patients through register → token → case → Rx → dispense → pay, including a 00:15 IST payment and two simultaneous registrations.

**Done when:** the scenario round passes and no failure mode is silent.

---

## Block 4 — Scale + UX polish

- Replace client-side aggregation with Postgres aggregate RPCs for `fetchReports` (year), `fetchOwnerStats`, `fetchDoctorDashboard`, `fetchWeekRevenue`; cache `runHealthChecks` counts.
- Loading states on `owner/audit-log`, `owner/health`, `owner/whatsapp`; error state on the pharmacy prescriptions query.
- Busy guards on Lead "Convert" and all row-level delete buttons.
- `aria-label` on every icon-only close and delete button.
- One language decision applied consistently across toasts and chrome.
- Tablet layout between 430px and 1024px.

**Done when:** reports load in constant time regardless of clinic volume and no screen shows a false-empty during load.

---

## Technical notes

- Blocks 2 and 3 include SQL migrations (`0022`+) that you run in the SQL editor, same as 0001–0021.
- Block 1 needs no database access at all, so it can land immediately.
- The `0000_bootstrap.sql` dump in Block 2 requires a `pg_dump --schema-only` from your project — I will give you the exact command to run and then commit the output.
