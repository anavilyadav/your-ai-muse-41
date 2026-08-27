# YHC-OS — Full Audit + Improvement Plan

Scope note: the live app runs on your own backend project, not the one my tools can query. So every claim below comes from reading the code in this workspace. Anything that depends on live database state (whether `0043` RLS is actually applied, real row counts) is marked **unverified** and gets a verification step instead of an assertion.

---

## What I actually measured

| Signal | Count | Where |
|---|---|---|
| `src/lib/db.ts` size | 4,423 lines | one file holds the whole data layer |
| `if (error) return []` / `return null` | 45 error branches, 27 returning empty | `db.ts` |
| `console.error` with no user-visible signal | 38 | `db.ts` |
| Empty / swallowing `catch {}` blocks | 30 | across `src/` |
| Routes with `errorComponent` | 1 of 42 | `src/routes/` |
| Files with any `aria-label` | 13 | `src/` |
| `select("*")` reads | 35 | `db.ts` |
| Client-side `.reduce()` aggregations | 10 | `db.ts` |
| `.limit(...)` caps on those same reads | 31 | `db.ts` |
| Test files | 8 suites | `src/lib/*.test.ts` |

---

## Area 1 — Silent failures (the biggest real risk)

This is the category you asked about, and it is the app's dominant defect class.

**The pattern:** 27 read functions do `if (error) { console.error(...); return [] }`. A permission denial, an expired session, or a dropped network call renders as *"no data"* — identical to a genuinely empty list. On a clinic screen that means:

- Today's Queue shows zero patients when the query failed → reception assumes nobody is waiting.
- Outstanding dues shows ₹0 when the read failed → money is never chased.
- Pharmacy stock shows empty → dispensing is blocked with no explanation.
- Reports show ₹0 revenue for a day that actually earned money.

This risk rises sharply the moment RLS lands: a wrong policy turns every screen into a plausible-looking empty state instead of an error.

**Fix:** change every read in `db.ts` to return a discriminated result — `{ ok: true, data }` or `{ ok: false, reason }` — and update callers screen by screen to render "Couldn't load — Retry" instead of an empty list. Screens get three distinct states: loading, error, genuinely-empty.

**The 30 swallowing `catch {}` blocks** get triaged into two groups: deliberately-best-effort (logging, analytics — keep, but add a comment saying so) and accidentally-silent (writes, uploads, WhatsApp sends — must surface).

**Only 1 of 42 routes has an `errorComponent`.** A throw during SSR on the other 41 blanks the page. Every route gets `errorComponent` and `notFoundComponent`.

---

## Area 2 — Security / RLS finish line

`0043_rls_core_phase1.sql` exists in the repo. Whether it has been **applied** to your live project is unverified — I can't query that project. Step one is verifying, not assuming.

1. Verify with `has_table_privilege` per table (not `information_schema` — that's the exact trap `0029` documents) and an anon-key read attempt that must fail.
2. Smoke-pass the whole clinic flow signed in as each role — register → token → case → Rx → dispense → pay — before calling it done. RLS is the one change that can lock out the live clinic.
3. Storage: confirm `case-photos` and `patient-documents` buckets are Private and carry `storage.objects` policies matching the table rules. Photos are clinical data.
4. Re-audit the edge functions that still take public URLs (lead webhooks) for signature verification.

---

## Area 3 — Reports correctness at scale

10 aggregations run client-side with `.reduce()` behind a row `.limit()`. At clinic volume the limit truncates the rows *before* the sum — the totals go **silently wrong**, not slow. This is a silent failure that costs money, so it belongs alongside Area 1.

Fix: push day/week/month/year/custom-range totals, owner stats, doctor dashboard and week revenue into Postgres aggregate RPCs with branch and date-range parameters. Cache the `runHealthChecks` counts.

Also: the 35 `select("*")` reads get narrowed to the columns actually rendered — clinical notes currently ship to screens that never display them.

---

## Area 4 — UX, accessibility, consistency

- Loading and error branches on `owner/audit-log` and `owner/health` (currently neither has any).
- Busy guards on Pharmacy prescriptions, Lead "Convert", and row-delete — today a double-tap fires twice.
- `aria-label` on icon-only close/delete buttons (only 13 files have any).
- One language throughout. Hinglish strings still sit next to English chrome in ~15 route files. My recommendation: **Hinglish everywhere**, since reception staff read it — say the word if you want English.
- Tablet layout between 430px and 1024px.

---

## Area 5 — Structure and tests

- `db.ts` at 4,423 lines is a single point of merge pain. Split by domain: `db/patients.ts`, `db/payments.ts`, `db/inventory.ts`, `db/reports.ts`, `db/leads.ts` — re-exported so no call site changes.
- 8 test suites exist and cover payments, follow-ups, inventory, patient records, fees, IST. The gaps: lead webhooks (signature rejection, duplicate, malformed), card number series and family links under concurrent inserts, the payment-status guard, and the new error-result shape from Area 1.
- Raise the CI coverage floor in two steps so the build stays green while the suite fills in.

---

## How to recheck that each fix actually works

Not "it compiles" — each item has a failure it must now visibly produce.

| Fix | Recheck |
|---|---|
| Error-vs-empty | In devtools, block the backend host, load Queue/Outstanding/Pharmacy. Each must show "Couldn't load — Retry", never an empty list. |
| RLS | Hit a core table with the anon key from curl — must return a permission error. Then run the full clinic flow as each role and confirm nothing is blocked. |
| Report totals | Pick a month with more rows than the old `.limit()`. Compare the screen total against a direct `SUM()` in SQL. They must match exactly. |
| Busy guards | Double-tap Convert / Pay / Delete fast. Exactly one row must be created. |
| Route errors | Force a throw in one loader — that route shows its error component, the rest of the app keeps working. |
| Tests | Deliberately break a split-payment total in `db.ts` — CI must go red. |
| Accessibility | Keyboard-tab the Rx and Register screens end to end; every control reachable and named. |

---

## Order

Area 1 (silent failures) → Area 3 (report correctness) → Area 2 (RLS verify + finish) → Area 4 (UX) → Area 5 (structure/tests, folded in as we touch each file).

Area 1 first because it's what makes every other change safe to verify: until failures are visible, a broken RLS policy and a working one look identical on screen.

## Technical notes

- New SQL lands as `0045+` in `supabase/sql-manual/`, same as 0024–0044, for you to run.
- Areas 1, 3, 4 and 5 need no database access.
- Nothing here re-does already-fixed items (atomic reschedule `0024`, payment idempotency `0025`, signed-URL photos, degraded-mode banner, RPC anon revoke `0029`, split payments `0037`).
