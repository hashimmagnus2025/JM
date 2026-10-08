# 12 · Phase 0 + Phase 1 — Status, Verification and Honest Limits

**Date:** 2026-10-08 · **Branch:** `claude/eager-turing-u8m8c9` · **Scope:** foundation (Phase 0) + finance core (Phase 1). No frontend screens.

## 12.1 What was built

| Area | Where | Notes |
|---|---|---|
| Monorepo | `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json` | pnpm workspaces; Node ≥ 22; TypeScript 5.9 `strict` + `noUncheckedIndexedAccess` |
| Shared primitives | `packages/shared` | `money.ts` (integer paise, BigInt-safe percentages, largest-remainder splits, ₹ formatting, strict parser) · `dates.ts` (`BusinessDate`, IST `Clock`, epoch-day arithmetic, academic-year labels) · `canonical.ts` |
| Design tokens | `packages/ui` | "Ledger" tokens → generated `tokens.css` (light + dark + reduced motion); **WCAG AA contrast verified by test** |
| Finance engine (pure) | `apps/api/src/domain/finance/*` | 20 modules; see §12.4 |
| Academic rules (pure) | `apps/api/src/domain/academic/teacher-assignment.ts` | BRC-B6 |
| Billing (isolated) | `apps/api/src/domain/billing/active-students.ts` | BRC-K1; cannot import the fee engine (lint + test enforced) |
| Posting kernel | `apps/api/src/modules/payments/*` | transactional payment posting + reversal over a `LedgerStore` port; in-memory model + MongoDB adapter |
| Persistence | `apps/api/src/db/*` | 41 Mongoose models, indexes, DB-level `$expr` validators, migration 001 |
| HTTP shell | `apps/api/src/app.ts`, `server.ts`, `worker.ts` | request id, structured logs with redaction, Helmet, `/healthz` + `/readyz`, safe errors; env validated at boot |
| DevOps | `ops/docker/*`, `.github/workflows/ci.yml`, `.env.example` | Dockerfile (multi-stage, non-root), dev compose (Mongo **replica set**, Redis, MinIO), CI (lint, format, types, tests+coverage, build, audit, **real-Mongo integration job**, docker build) |
| Docs | `docs/architecture/11, 12` + patches to 00–10 | decision register with BRC mapping |

## 12.2 Schema summary (41 collections)

Platform 5 (`institutions`, `system_settings`, `counters`, `files`, `idempotency_keys`) · academic 4 · teachers 2 · students 3 · fee configuration 5 · **ledger 10** (`receivables`, `opening_balances`, `adjustments`, `payments`, `payment_allocations`, `payment_reversals`, `receipts`, `student_year_balances`, `daily_snapshots`, `collection_targets`) · communication 5 · identity/audit/bulk 7.
Money fields are integer paise (schema validator); dates are `YYYY-MM-DD` strings; `institutionId` on every business collection; `autoIndex`/`autoCreate` off (migration owns structure); no `__v`.

## 12.3 Index summary

**103 indexes: 38 unique, 9 partial, 2 TTL, plus 4 collection validators.** The ones that protect the money:

| Rule | Index / validator |
|---|---|
| No duplicate payment / retry | unique `(institutionId, idempotencyKey)`; unique `(institutionId, paymentNo)` |
| No duplicate UPI/bank/card reference (re-usable after reversal) | partial unique `uniqueRefKey` where `$type:'string'` (key is unset on reversal) |
| No duplicate receipt / one receipt per payment | unique `(institutionId, receiptNo)`; unique `(paymentId)` |
| A payment / an allocation is reversed once | unique `payment_reversals.paymentId`; partial unique `reversesAllocationId` |
| No duplicate installment / opening-balance receivable / penalty | unique `(institutionId, dedupeKey)` |
| No duplicate opening balance | partial unique `(studentId, academicYearId)` where `status = ACTIVE` |
| No duplicate fee assignment | partial unique `(studentId, academicYearId)` where `status = ACTIVE` |
| No duplicate enrollment | partial unique `(studentId, academicYearId)` where `isCurrent` |
| One class teacher per division (a teacher may hold several divisions) | partial unique `(divisionId, role)` where `isCurrent` |
| One current academic year | partial unique `(institutionId)` where `isCurrent` |
| Broken arithmetic cannot be stored | `$expr` validators on `receivables`, `payments`, `payment_allocations`, `opening_balances` |
| Fast overdue / reminder scans | partial index `(institutionId, dueDate)` where `pending > 0` |

## 12.4 Finance-engine summary

Pure functions over integer paise and IST business dates (no I/O, no clock — lint + test enforced).

| Module | Responsibility (decision) |
|---|---|
| `build-installments` | plan / full / custom installments, installment-specific components, exact rounding (BRC-C4 default: remainder to last) |
| `opening-balance` | separate receivable, never part of gross fee, one active per student-year, ages from its due date |
| `carry-forward` | **manual** prior-year carry-forward (BRC-D1): `transferred` bucket + new opening balance; total unchanged |
| `adjustments` | discount/concession/scholarship/waiver; exact distribution; never below what is paid; pending ≠ effective |
| `late-fee` | fixed / per-day / percentage / installment-specific / grace / cap; separate PENALTY receivables; idempotent; history never rewritten (BRC-F1) |
| `allocate` | oldest-due-first tiers, component priority, manual allocation, overpayment rejected unless advance enabled (BRC-E1) |
| `reversal`, `reversal-policy` | compensating negative allocations; mandatory reason; threshold-driven optional approval, no hard-coded amount (BRC-E6) |
| `status`, `summary`, `aging` | Paid / Fully Settled / Due Soon / Overdue; Expected, Collected, Collection %; per-year and cross-year totals; 0–30/31–60/61–90/90+ from original due date (BRC-I1/I2, BRC-D1) |
| `receipt-number` | `REC-2026-000001`, configurable prefix/scope, never reused (BRC-G1) |
| `preview` | `buildFeePreview()` — the single function behind admission preview **and** save; money-only hash basis (decision #15) |
| `fee-structure`, `fee-version` | most-specific-wins resolution; published versions immutable (decision #11) |

## 12.5 Verification results

Run on this branch (Node 22, pnpm 10):

| Check | Result |
|---|---|
| `pnpm lint` (ESLint incl. architecture-boundary rules) | ✅ clean |
| `pnpm format:check` | ✅ clean |
| `pnpm typecheck` (3 packages) | ✅ clean |
| `packages/shared` | ✅ 31 tests |
| `packages/ui` | ✅ 40 tests (incl. 36 WCAG contrast checks, generated-CSS drift guard) |
| `apps/api` | ✅ 330 passed · **41 skipped** (see below) |
| **Finance engine coverage** | **99.3 % statements · 92.4 % branches · 99.5 % functions** (CI gate 95 / 90 / 95) |
| `pnpm audit --prod --audit-level=high` | ✅ no known vulnerabilities |
| Production build (`tsup`) + fail-fast boot without env | ✅ |
| `pnpm deploy --legacy` (used by the Dockerfile) | ✅ |
| **Mutation check** (21 deliberate bugs in money rules, ordering, concurrency guards, idempotency, aging, penalties, rounding, billing…) | ✅ **21 / 21 caught** |

**Required-scenario coverage** (each has automated tests): normal · zero amount · partial · full · overpayment · multiple installments · opening balance · prior-year outstanding · late fee · discount/concession · payment reversal · duplicate request/idempotency · concurrent payment attempt · historical academic-year separation — plus SOW golden fixtures (§5/§6, §12, §15, §17, §31, §35) and the §7.11 FEE SUMMARY (₹35,000).

### ⚠ What was NOT run here (be precise)
- **41 tests are skipped locally: the real-MongoDB integration suite** (`mongo-ledger-store.integration.test.ts`). MongoDB cannot be downloaded in this sandbox (egress policy) and there is no Docker daemon. It runs automatically in the CI `integration` job against a real replica set — **that CI run is the first execution of the MongoDB adapter, the migration, the DB validators and the unique indexes.** Treat those as *written and type-checked, not yet proven*.
- The same posting scenarios (concurrency, idempotency, reversal, atomicity) **do** run on the **in-memory model**, which reproduces snapshot isolation, first-committer-wins write conflicts, unique indexes and atomic commit. It is a faithful model, not MongoDB.
- The Dockerfile and `compose.dev.yml` were not built/started here (no Docker daemon); CI `docker` job will. `ci.yml` itself has not run yet.
- DB-level `$expr` validators were verified with `mingo` (a JS implementation of the same expressions), not by a server.

## 12.6 Unresolved business rules

Still open (defaults apply behind settings): A1–A3 · B1–B5 · C1–C5 · **D2** (migrated payments/receipts) · **E2–E5** (advance & refunds — advance is **off**, so over-payment is rejected; cheque lifecycle; back-dating) · **F2** (discount policy details) · H1–H4 (reminders) · I3–I5 (targets, forecast, "active" on dashboard) · J1–J4 · and the **CL-01…CL-14** interpretations in [11 §11.4](11-business-rule-decisions.md). New to confirm:
- **CL-15 (found in Phase 1):** receipt/payment numbers come from atomic counters outside the transaction → an *aborted* payment can leave an unused number (a gap). This follows BRC-G1 ("gaps allowed") but means gaps can also appear for failed attempts, not only cancelled receipts.
- **CL-04 again:** `PER_DAY` penalties create one receivable per overdue day; consider weekly/monthly posting if volume matters.

## 12.7 Architectural risks & honest limits

| # | Risk / limit | Mitigation / next step |
|---|---|---|
| 1 | **MongoDB adapter unproven** (see 12.5) | CI integration job; do not release before it is green |
| 2 | **Hot-counter serialisation** was a real design flaw (every payment write-conflicted on one counter) — caught by mutation testing | Fixed: counters outside the transaction, reserved once per command; regression tests assert no cross-student conflicts |
| 3 | Kernel is **not the whole payment feature**: it does not yet recompute `student_year_balances`, build the full receipt snapshot/PDF, hash-chain audit entries, or call the notification/cache hooks | Phases 11–13 |
| 4 | Generic `idempotency_keys` store is defined but not wired; payments use their own unique key; reversal retry returns "already reversed" rather than replaying the first response | Wire when HTTP layer lands (Phase 11) |
| 5 | Penalty **job**, fee-structure/assignment **services**, admission **command**, promotion are not built — only their pure rules | Phases 8–10 |
| 6 | Receivable `classId/divisionId` dimensions must be re-synced on a mid-year division move (amounts untouched) | Enrollment service, Phase 7 |
| 7 | Allocation spans **all years, oldest first** → a cashier paying "this year's fee" could unknowingly clear prior-year dues | Collection UI must show the allocation preview and offer "pay selected dues only" (`eligibleReceivableIds`) |
| 8 | `0–30` bucket includes items due today while *Overdue* means `dueDate < today` (CL-11); aging uses the **original** due date even after an extension | Documented; confirm CL-11 |
| 9 | Single-node replica set on one VPS is **not** high availability | Backup/restore drills (Phase 20); managed replica set later, no code change |
| 10 | In-memory model ≠ MongoDB for edge semantics (e.g. WriteConflict timing) | Same scenarios run on real Mongo in CI |
| 11 | TypeScript pinned to 5.9 (7.x current, but the lint toolchain's peer range stops below 6.1); Node 22 LTS baseline | Revisit with toolchain |

## 12.8 How to run

```bash
pnpm install
pnpm check                          # lint + format + typecheck + tests
pnpm --filter @sfm/api test:coverage
docker compose -f ops/docker/compose.dev.yml up -d      # Mongo replica set, Redis, MinIO
MONGO_URI='mongodb://localhost:27017/sfm_test?replicaSet=rs0&directConnection=true' \
  pnpm --filter @sfm/api exec vitest run src/modules/payments/mongo-ledger-store.integration.test.ts
cp .env.example .env && pnpm --filter @sfm/api db:migrate && pnpm --filter @sfm/api dev
```
