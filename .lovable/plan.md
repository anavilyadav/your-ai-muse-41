# YHC-OS Master Production Audit Plan

## Scope and non-negotiables

This is an **audit-only** engagement. No application code, database schema, RLS policy, authentication setting, workflow, package, design, or deployment will be changed.

The audit will distinguish:
- Verified working
- Partially implemented
- Broken
- Insecure
- Poorly implemented
- Missing but important
- Unnecessary
- Optional future
- Advanced / experimental
- Unverified because live access or test data is unavailable

Every material finding will cite evidence: source file and line, SQL/function definition, runtime observation, database query, test output, or dependency advisory. UI presence will never count as proof that a workflow works.

## Known audit boundary to resolve explicitly

The app source is configured for a different backend project than the Lovable Cloud project available to the audit tools. Read-only queries against the available project returned an empty public schema, while the app’s own client points elsewhere. Therefore:

- Source-code and migration findings can be verified now.
- The actual production database state, applied migrations, RLS policies, grants, storage privacy, real row counts, Auth settings, and live RPC privileges must be marked **UNVERIFIED** unless the app’s real backend can be queried or exercised through an authenticated runtime session.
- A clean/stale automated scanner result will not override contradictory source or runtime evidence.
- The report will separate “migration exists in Git” from “migration is applied live.”

## Audit execution

### 1. Build the master system map
Inventory all 43 application routes plus the root layout, shared shells, forms, modals, navigation paths, role/permission gates, data calls, referenced tables/RPCs, 15 backend functions, storage flows, imports/exports, scheduled jobs, WhatsApp/lead integrations, offline queue, backups, health checks, and environment boundaries.

Cross-reference in both directions:
- UI → data function → table/RPC/function
- Table/RPC/function → every UI or automation consumer

Flag UI without a real backend, backend without a UI, unreachable paths, stale controls, and competing implementations.

### 2. Page-by-page functional audit
For every route, record:
- Purpose and intended role(s)
- Major controls, forms, dialogs, search/filter/sort, uploads, downloads, and navigation
- Data source, tables, RPCs, functions, and background side effects
- Loading, empty, error, retry, timeout, success, and duplicate-submit behavior
- Validation, destructive-action confirmation, unsaved-change protection, mobile/tablet/desktop behavior, accessibility, and security boundaries
- Status and 0–100 scores for functionality, reliability, security, performance, UI, UX, accessibility, data integrity, production readiness, and overall readiness

High-risk pages receive deeper walkthroughs: registration, patient profile, appointments, payment, lead conversion, case-taking, prescription, dispensing, inventory, owner controls, imports, reports, WhatsApp, staff management, and health/audit screens.

### 3. End-to-end clinic workflow tracing
Trace every stage and every state transition:

```text
Lead → Patient registration → Appointment/walk-in → Reception queue
→ Case-taking → Doctor prescription → Pharmacy dispense → Payment
→ Follow-up → Delivery/communication → Reports/audit
```

For each transition, verify record ownership, IDs, status changes, atomicity, retry behavior, idempotency, recovery paths, historical preservation, and what the next staff member sees. Test returning-patient and master-patient behavior separately from visit history.

### 4. Silent-failure register
Search and trace all suppressed errors, fallback defaults, empty catches, console-only failures, success-before-confirmation, zero/empty fallbacks, stale query data, partial multi-step writes, unregistered offline submitters, failed upload/WhatsApp/logging paths, background-job failures, loading hangs, and counters that can quietly become wrong.

Each register row will contain:
- ID and page/workflow
- Trigger
- What staff sees
- What actually happens
- Data/financial/clinical impact
- Detectability
- Evidence
- Severity
- Exact verification test
- Recommended fix, without implementing it

Already evidenced candidates to fully trace include the patient-profile infinite loading path, console-only secondary-write failures, settings JSON falling back silently, offline queue persistence/replay, partial import undo, service-worker registration, and backup failure visibility.

### 5. Database and data-integrity audit
Compare all migration definitions and app assumptions for:
- PKs, FKs, unique constraints, nullability, checks, indexes, cascades, soft deletion, historical records, and audit identity
- Duplicate patients, visits, appointments, payments, card numbers, leads, prescriptions, follow-ups, and replayed offline submissions
- Orphans and mutable identity references
- Transactions, locks, optimistic concurrency, idempotency keys, stock races, double payments, appointment conflicts, lost updates, and partial rollbacks
- Query projection, row caps, pagination, N+1 behavior, client-side aggregation, and date/IST correctness

Model behavior at 1k, 10k, 50k, and 100k+ patients, identifying the first concrete bottleneck and the affected screen/query rather than giving a generic scalability verdict.

### 6. Security and privacy audit
Trace real trust boundaries rather than frontend visibility:
- Authentication, PIN strength, lockout bypass, session handling, idle logout, token storage, sign-out cleanup, and account recovery
- Server-side authorization for every sensitive table, RPC, function, and destructive/money-moving action
- RLS enablement versus policy quality; grants; `SECURITY DEFINER`; PUBLIC/anon/authenticated execute privileges; branch and role isolation; audit-log forgery risk
- IDOR/parameter tampering by changing patient, visit, payment, prescription, appointment, staff, and branch identifiers
- Storage bucket privacy, object policies, signed URLs, upload validation, file types/sizes, and clinical-photo/document leakage
- Service-role confinement, exposed environment values, console/URL leakage, CORS, webhook signatures, cron secrets, replay protection, abuse limits, and provider response handling
- XSS, unsafe rendering, redirects, sensitive localStorage content, PDFs, and export privacy

Every security issue will include severity, vulnerable asset, realistic exploit, impact, evidence, fix, complexity, and required live verification. Existing broad authenticated policies in the pending RLS migration and the direct password-sign-in fallback will be treated as stop-ship candidates, not softened by frontend role gates.

### 7. Domain audits
Run separate evidence-backed audits for:
- Appointment lifecycle and scheduling conflicts
- Reception’s full-day workflow
- Doctor case-taking, history, photos, drafts, unsaved work, prescription limits, and follow-up generation
- Pharmacy medicine master, stock, dispense synchronization, batch/expiry/FEFO/reorder, and adjustment accountability
- Payments, splits, outstanding balance, credit, refunds/adjustments, receipts, reconciliation, duplicate prevention, and staff manipulation
- Follow-up/CRM, lead conversion, reminders, consent, quiet hours, missed work, escalations, and IST boundaries
- KPI lineage from displayed number to query/RPC/table/calculation, including revenue, collections, outstanding, conversions, cancellations, no-shows, source performance, and doctor/staff metrics

### 8. Quality, UX, performance, and operations
Audit:
- Desktop, tablet, and mobile at representative widths, especially large data-dense screens and dialogs
- Keyboard flow, labels, focus, contrast, touch targets, destructive dialogs, reduced motion, language consistency, and screen-reader basics
- Query volume, payload sizes, `select(*)`, image/PDF handling, polling, cache freshness, rerenders, and bundle/dependency risk
- Architecture and maintainability, including the 4,881-line data module and 600–1,050-line route files
- CI enforcement, route/UI/backend/SQL test gaps, migration testing, and E2E coverage
- Error telemetry, durable alerts, audit completeness, failed-job visibility, backup coverage, restore procedure, rollback, and disaster recovery
- Public/private indexing boundary, metadata, robots behavior, and accidental patient-data exposure

### 9. Runtime and adversarial verification
Without mutating production data:
- Inspect public and authenticated route behavior, navigation, error states, console errors, and network failures.
- Where a safe test account/session and real backend are available, attempt role bypass, direct API/RPC access, alternative IDs, duplicate submission, stale-tab actions, and parallel-user races using reversible/non-destructive checks.
- Verify storage privacy and signed-link behavior without downloading or exposing real patient files.
- If authenticated live verification is unavailable, label each affected result `Authenticated path: UNVERIFIED`; do not claim a security or workflow fix exists.
- Run existing tests and type checks only as audit evidence. Report lint’s non-blocking status and the true coverage denominator, including excluded routes/functions/SQL.

## Deliverables

Produce `YHC-OS_MASTER_AUDIT_REPORT.md` as a standalone report with the requested 42 sections:
1. Executive Summary
2. Current System Architecture
3. Complete Module Inventory
4. Complete Page Inventory
5. Page-by-Page Audit
6. Functional Audit
7. Silent Failure Audit
8. Database & Data Integrity Audit
9. Security Audit
10. Authentication & Authorization Audit
11. Supabase/RLS Audit
12. Patient Data & Privacy Audit
13. Clinic Workflow Audit
14. Appointment Audit
15. Reception Audit
16. Doctor/Case-Taking Audit
17. Pharmacy/Medicine Audit
18. Payment Audit
19. Follow-Up/CRM Audit
20. Analytics Audit
21. Performance Audit
22. UI Audit
23. UX Audit
24. Mobile/Tablet/Desktop Audit
25. Accessibility Audit
26. Code Quality Audit
27. Testing Audit
28. Backup/Disaster Recovery Audit
29. Logging/Observability Audit
30. Scalability Audit
31. Business Operations Audit
32. Red Flag Register
33. Page-Wise Scorecard
34. Module-Wise Scorecard
35. Overall System Score
36. What Is Working Well
37. What Is Broken
38. What Is Partially Implemented
39. What Is Missing
40. What Should Be Improved
41. Top 1% Clinic OS — Additional Opportunities
42. Recommended Priority Roadmap

The report will also include:
- A master evidence ledger
- A silent-failure register
- A red-flag register with P0/P1/P2/P3, impact, evidence, fix, complexity, and dependency
- Security/privacy maturity scores by control area
- Page and module scorecards with explicit scoring rationale
- “Do not change” list for proven-good behavior
- A concise final answer to all requested questions, including an evidence-calibrated score out of 100

## Recommendation structure only — no implementation

Recommendations will be separated from findings and ordered as:
- Phase 0 — Stop-ship
- Phase 1 — Critical fixes
- Phase 2 — Reliability and data integrity
- Phase 3 — Workflow optimization
- Phase 4 — UI/UX and accessibility
- Phase 5 — Performance and scale
- Phase 6 — Automation and intelligence
- Phase 7 — Top 1% / experimental capabilities

Each recommendation will state expected benefit, risk reduced, effort, dependencies, acceptance criteria, and exact recheck steps. No recommendation will be implemented until separately approved.
