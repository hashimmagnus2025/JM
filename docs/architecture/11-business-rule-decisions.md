# 11 · Final Business-Rule Decisions (Decision Register)

**Version:** 1.0 · **Date:** 2026-10-08 · **Source:** client decision message for Phase 0 + Phase 1.
**Authority:** this register **supersedes** any "proposed default" in documents 00–10. Where a baseline document and this register disagree, this register wins; the baseline documents have also been patched (see §11.6).

Status legend: ✅ **DECIDED** (client) · 🔶 **DECIDED + clarification** (client rule implemented; an interpretation I had to make is listed in §11.4 as `CL-nn` and awaits a yes/no).

---

## 11.1 Decision → BRC map

| # | BRC | Decision (final) | Status | Implemented in (engine / setting) | Tests |
|---|---|---|---|---|---|
| 1 | **BRC-D1** Prior-year outstanding | **Keep unpaid dues attached to their original academic year.** No automatic conversion to opening balance. Total receivable may *aggregate* years; year ownership is always preserved. Carry-forward is a **controlled, manual, audited** operation only. | 🔶 CL-12 | `summary.summarizeByAcademicYear`, `summary.summarizeAll`; `carry-forward.planCarryForward` (manual op, never invoked automatically); receivable `transferred` field | `prior-year.test.ts`, `carry-forward.test.ts` |
| 2 | **BRC-E1** Allocation order | **Oldest due first**: ① oldest overdue receivable ② opening balance ③ penalty ④ oldest pending installment ⑤ newer installments. **Inside one receivable: configured fee-component priority** (replaces the earlier "pro-rata" proposal). Order must be configurable later. Every allocation stored as an immutable record. | 🔶 CL-01, CL-02 | `allocate.ts` strategy registry (`OLDEST_DUE_FIRST`), setting `allocation.strategy`, `allocation.componentPriority[]`; `payment_allocations` append-only | `allocate.test.ts` |
| 3 | **BRC-F1** Late fee | Configurable: **fixed**, **per-day**, **percentage**, **installment-specific**, **grace period** (default 0), **max cap**. Applies to the overdue installment/receivable. **Never auto-applied to opening balance** unless explicitly configured. **Posted as separate PENALTY receivables**; once posted they are history; later rule changes never rewrite them or reprint receipts. | 🔶 CL-03, CL-04, CL-05 | `late-fee.ts` (`computePenaltyPostings`, `buildPenaltyReceivable`); `late_fee_policies` (versioned) | `late-fee.test.ts` |
| 4 | **BRC-E6** Payment reversal | Collectors **cannot** reverse. Finance/Admin by **permission** (`payment.reverse`). **Mandatory reason**, audit, original **never edited/deleted**, receipt **number preserved & marked cancelled**, **compensating allocations**. Optional 2nd-level approval for high-value payments with a **configurable threshold (no hard-coded amount; default = disabled)**. Reversal report: Original Payment Date · Original Amount · Reversal Date · Reversed Amount · Reason · Authorized By. | 🔶 CL-06, CL-07 | `reversal.ts`, `reversal-policy.ts`; setting `reversal.approval.thresholdPaise` (`null` = off); `payment_reversals` fields | `reversal.test.ts`, `reversal-policy.test.ts` |
| 5 | **BRC-G1** Receipt numbering | `REC-2026-000001` = prefix + scope year + 6-digit sequence. Unique; **never reused**; **gaps allowed**; never renumber; prefix & numbering scope **configurable**; users can never type a receipt number. | 🔶 CL-08 | `receipt-number.ts`; setting `receipt.numbering {prefix, scope, pad}`; unique index `(institutionId, receiptNo)`; counters | `receipt-number.test.ts` |
| 6 | **BRC-I1 / I2** Status & metrics | **Paid**: remaining balance 0 **and** no active pending adjustment on that receivable. **Fully Settled**: whole obligation of the student/fee scope cleared. **Due Soon**: configurable, default **7 days** before due date. **Expected Fees**: applicable fee obligations of the selected year/scope; **opening balance excluded**, shown separately. **Collection % = Collected ÷ Expected × 100** (selected scope; opening balance not in denominator). **Aging** from the receivable's **original due date**, buckets **0–30 / 31–60 / 61–90 / 90+**; opening balances age from their configured effective/due date. | 🔶 CL-09, CL-10, CL-11 | `status.ts`, `summary.ts`, `aging.ts`; settings `status.dueSoonDays`, `aging.boundaries`, `aging.basis`, `metrics.expectedIncludesPenalties` | `status.test.ts`, `summary.test.ts`, `aging.test.ts` |
| 7 | **BRC-B6** Class-teacher rules | A teacher **may** be class teacher of **multiple divisions** (default **allow**, setting). **One active class-teacher assignment per division-year** at any time. Change = close old row + create new row; history preserved. **No teacher logins in release 1.** Historical views show the teacher assigned in that period. | 🔶 CL-14 | `domain/academic/teacher-assignment.ts`; setting `teacher.allowMultipleDivisions=true`; partial unique index `(divisionId, role) where isCurrent` | `teacher-assignment.test.ts` |
| 8 | **BRC-K1** Active student / ₹120 | Configurable, **separate from the fee engine**. Active = has an active enrollment in the period and is not Withdrawn / Inactive / Passed-out / Transferred. **Unique students**; duplicate enrollments not double-counted. Charge generated from the active count at the configured billing point. | 🔶 CL-13 | `domain/billing/*` (no imports from `domain/finance`); settings `billing.ratePerStudentPaise` (12000), `billing.point` | `billing.test.ts` |

## 11.2 The 15 architectural decisions → where each is enforced

| # | Decision | Enforcement |
|---|---|---|
| 1 | Opening balance is a separate receivable type | `kind = OPENING_BALANCE`, own system component `OPENING_BALANCE` |
| 2 | Opening balance never added to the year's gross fee | `summary` excludes it from Gross/Expected; test asserts Gross unchanged |
| 3 | Outstanding **always derived** from receivables + allocations + valid adjustments | `pending = payable − adjusted − transferred − paid` (invariant + DB `$expr` validator); no stored "current outstanding" is ever authoritative (`student_year_balances` is a rebuildable projection) |
| 4 | No manually editable outstanding as source of truth | No API or schema field accepts it; projection is write-only from the engine |
| 5 | Payments, allocations, receipts, audit append-only | No generic update/delete in repositories; insert-only DB role (hardening phase) |
| 6 | Reversals are compensating entries | `reversal.buildReversalAllocations` (negative rows) |
| 7 | Transactions for important financial operations | `LedgerStore.runInTransaction` port; Mongo adapter uses `withTransaction` |
| 8 | Idempotency for payments & retry-sensitive APIs | `lib/idempotency.ts` decision + unique `(institutionId, idempotencyKey)`; replay returns the original result |
| 9 | Integer paise | `@sfm/shared/money` (BigInt-safe percent math), Zod/Mongoose guards |
| 10 | IST-safe dates | `BusinessDate` strings + `Clock` (`Asia/Kolkata`); UTC-midnight tests |
| 11 | Published fee structures immutable | `fee-version.ts` (`contentHash`, `assertVersionEditable`); no update path |
| 12 | Enrollment history never overwritten | append-only enrollments, partial unique `isCurrent` |
| 13 | Teacher assignment history never overwritten | close-and-create only |
| 14 | Backend finance engine = single source of truth | `domain/finance` pure; web only formats |
| 15 | Admission preview and save use the same engine | `preview.buildFeePreview()` is the only function either path calls; save re-runs it and compares `previewHash` |

## 11.3 Detailed rules as implemented

### D1 · Prior-year outstanding (Model A)
- Receivables carry `academicYearId`. Payment allocation looks across **all years** of the student, oldest due first, so old dues are collected first — but each allocation row records the receivable's own year (`academicYearId` on the allocation), so year ownership never changes.
- Student financial history shows each year separately (`2025-26 outstanding ₹10,000`, `2026-27 fee ₹50,000`) plus a clearly labelled **cross-year total receivable**.
- **Carry-forward (optional manual operation):** `planCarryForward` returns, for one transaction: (a) *transfer-out* amounts on the source receivables' `transferred` counters (reduces their `pending`, **not** counted as a discount, **not** as collected), (b) one `OPENING_BALANCE(source=CARRY_FORWARD)` in the target year referencing the sources. Total outstanding is unchanged by the operation (tested). It needs `openingBalance.create` + `openingBalance.carryForward`, a mandatory reason, and writes `OPENING_BALANCE_CARRIED_FORWARD` audit entries on both years. Never run by a job.

### E1 · Allocation (`OLDEST_DUE_FIRST`)
Deterministic comparator over eligible receivables (`pending > 0`, not `VOID/WAIVED`):
1. **Tier 0 — overdue** (`dueDate < today`): `dueDate` ascending → kind rank (`OPENING_BALANCE`, `PENALTY`, `INSTALLMENT`) → installment no. → id.
2. **Tier 1 — not yet overdue:** kind rank (`OPENING_BALANCE`, `PENALTY`, `INSTALLMENT`) → `dueDate` ascending → installment no. → id.

This realises ① oldest overdue, ② opening balance, ③ penalty, ④ oldest pending installment, ⑤ newer installments (CL-01). Inside a receivable the amount is applied component by component in `allocation.componentPriority` order (codes not listed follow in the receivable's own component order). `strategy` name is stored on every payment (`allocationStrategy`) so the order used is auditable even after the setting changes. Manual allocation (permission-gated) is validated by the same invariants.

### F1 · Late fees
- **Modes:** `FIXED` (one posting of a fixed amount), `PER_DAY` (a fixed amount for each overdue day after grace), `PERCENT` (one posting of `bp` × the receivable's pending on the first penalty day).
- **Installment-specific:** `installmentOverrides[installmentNo]` can override mode/value/grace/cap per installment number.
- **Grace:** default 0 → the first penalty day is `dueDate + grace + 1`.
- **Cap:** total penalties per parent receivable ≤ `capPaise` (existing postings count).
- **Scope:** `appliesToKinds` default `['INSTALLMENT']`; opening balance only if `applyToOpeningBalance=true`; never on a `PENALTY`.
- **Posting:** each posting is a separate `PENALTY` receivable (`parentReceivableId`, `periodKey`, `policyId`, `policyVersion`), idempotent through `periodKey`. Penalties stop on days when the parent has nothing pending.
- **History:** rule changes affect **future periods only** (policy `effectiveFrom`); existing penalties and receipts are never recomputed.

### E6 · Reversal
- Permissions: `payment.reverse` (request/perform) — **not** granted to Fee Collector; `payment.reverseApprove` only matters when approval is configured.
- `reversal.approval.thresholdPaise`: `null`/unset = no second approval (default); a number = payments **≥** that amount need an approver who is a **different** user with `payment.reverseApprove`.
- Reversal creates negative allocation rows (`postingDate` = reversal date), restores `paid/pending`, cancels the receipt (number kept), unsets `uniqueRefKey`, writes audit with reason.
- **Reversal report columns:** original payment date · original amount · reversal date · reversed amount · reason · authorized by.

### G1 · Receipt numbers
`REC-{scopeKey}-{seq:000000}`; `scope ∈ ACADEMIC_YEAR | CALENDAR_YEAR | FINANCIAL_YEAR | NONE` (NONE → `REC-000001`). Counter key = `receipt:{prefix}:{scopeKey}`. Cancelled receipts keep their numbers; **gaps are allowed** (the baseline's "gap-free" requirement is withdrawn). Implementation note (found by mutation testing): sequence counters are **atomic increments outside the DB transaction** and are reserved **once per command** (reused when the transaction retries) — this is what removes any global serialisation of payments; the price is that an aborted payment can leave an unused number, which this decision explicitly allows.

### I1/I2 · Status & metrics (engine definitions)
- `PAID` ⇔ `pending = 0` ∧ `¬hasPendingAdjustment`. A zero-balance receivable that still has a pending adjustment is shown as **`PENDING_ADJUSTMENT`** (CL-09), never "Paid".
- `FULLY_SETTLED` (student scope: one year or all years) ⇔ every non-void receivable has `pending = 0` ∧ none has a pending adjustment (∧ no pending reversal at service level).
- `DUE_SOON` ⇔ `pending > 0` ∧ `today ≥ dueDate − dueSoonDays` ∧ `today ≤ dueDate`.
- **Expected Fees** = Σ(`payable − adjusted`) over `INSTALLMENT` receivables in scope (penalties and opening balance reported separately — CL-10). **Collected (for %)** = Σ`paid` over the same receivables. **Collection %** = Collected ÷ Expected (basis points internally; 0 when Expected = 0).
- **Aging** days = `today − originalDueDate`; buckets `0–30`, `31–60`, `61–90`, `90+` (configurable boundaries); future-dated items go to `notYetDue` (CL-11).

### B6 · Teacher rules
`allowMultipleDivisions` default **true**; when set to false a second current assignment for the same teacher in the same year is rejected. The partial unique index on `(divisionId, role)` where `isCurrent` is unconditional.

### K1 · Billing
`domain/billing` is isolated (lint-enforced: may not import `domain/finance`). `countActiveStudents(enrollments, students, period)` → unique `studentId`s; `computeAnnualStudentCharge(count, ratePaise)` → paise. Never touches receivables.

## 11.4 Clarifications — my interpretations (please confirm or correct)

| ID | Rule | Interpretation implemented | Alternative if you disagree |
|---|---|---|---|
| **CL-01** | E1 | The five-step list is implemented as the two-tier comparator in §11.3 (overdue items by age first; then opening balance → penalty → installments). An *overdue* penalty therefore ranks by its own due date (the day it accrued), i.e. after older overdue installments. | Make penalties/opening balance strictly rank above all installments regardless of age (strategy `PENALTY_FIRST`, already a registry slot). |
| **CL-02** | E1 | `allocation.componentPriority` is empty until you supply the list (e.g. Admission → Tuition → Transport…); until then components follow the fee-structure line order. | Provide the priority list. |
| **CL-03** | F1 | `PERCENT` is a **one-time** percentage of the receivable's pending balance on the first penalty day. Periodic percentage (e.g. 2 % per month) is **not** supported yet. | Specify the period and base; a `PERCENT_PER_PERIOD` mode can be added. |
| **CL-04** | F1 | `PER_DAY` creates **one penalty receivable per overdue day** (exact, append-only). Up to ~N rows per long-overdue installment. | Post weekly/monthly aggregates (`accrualPeriodDays`) — fewer rows, penalty visible only at period end. |
| **CL-05** | F1 | A penalty's `dueDate`/`originalDueDate` = its accrual date (so it is immediately due and ages from then); a late-running job back-posts missed days with their true accrual dates. | Date it at posting time. |
| **CL-06** | E6 | Only **full** reversal of a payment in v1 (`reversedAmount = original amount`). | Partial reversal / per-allocation reversal. |
| **CL-07** | E6 | "Authorized By" = approver when approval was required, otherwise the user who performed the reversal. | Always show requester and approver separately (both are stored). |
| **CL-08** | G1 | `ACADEMIC_YEAR` scope uses the **start year** of the academic year containing the **payment date** (`2026-27` → `2026`); `CALENDAR_YEAR` uses the IST calendar year of the payment date. | Use the receipt *issue* date, or the end year. |
| **CL-09** | I1 | Zero-balance receivable with a pending adjustment shows `PENDING_ADJUSTMENT` ("Settled – adjustment awaiting approval"), not `PAID`. | Different label/behaviour. |
| **CL-10** | I2 | Expected Fees = net installment fees only (after approved discounts); **penalties excluded** from Expected (setting `metrics.expectedIncludesPenalties=false`). Collected-for-% counts only payments applied to those fee receivables, so the % can never exceed 100 %. Opening balance and penalties have their own Collected/Outstanding lines. | Include penalties in Expected. |
| **CL-11** | I2 | `0–30` includes items **due today** (days = 0) while the *Overdue* KPI means `dueDate < today`, so the two can differ by "due today" items. Aging uses the **original** due date even if the due date was later extended. | Start buckets at 1 day; age from the current due date. |
| **CL-12** | D1 | Carry-forward modelled as a `transferred` amount on the source receivable + `OPENING_BALANCE(source=CARRY_FORWARD)` in the target year (total unchanged). | Alternative bookkeeping (e.g., write-off + new charge). |
| **CL-13** | K1 | "Active" = enrollment `isCurrent` in the period's academic year AND student status `ACTIVE` (so `INACTIVE`, `WITHDRAWN`, `PASSED_OUT`, `TRANSFERRED`, `ARCHIVED` are excluded). Billing point default = **year start date of the academic year** (configurable: fixed date / on-demand snapshot). | Different billing point (e.g., 30 June, or peak count). |
| **CL-14** | B6 | Past-year views resolve the teacher **as of the academic year's end date**; if the teacher changed during the period, all teachers with their date ranges are shown. Current-year views use today. | Always show the first / the longest-serving teacher. |

## 11.5 Rules still open (unchanged from §21)

A1, A2, A3 · B1–B5 · C1–C5 · **D2** (historical payments/receipts at migration) · **E2–E5** (advance payments & refunds, over-payment, cheque lifecycle, back-dating) · **F2** (discount/concession policy) · H1–H4 (reminders) · **I3–I5** (targets, forecast, "active" on dashboard) · J1–J4 · and the **CL-nn** confirmations above. Defaults from the baseline continue to apply behind settings (notably `advance.enabled=false`, so **overpayment is rejected**).

## 11.6 Baseline-document changes made with this register

| Document | Change |
|---|---|
| 00-README | v0.2 status, register link, decisions D2/D4 notes, next-steps rewritten |
| 01 | Node 22 LTS baseline; pnpm workspaces (Turborepo deferred); `domain/finance` may import only pure `@sfm/shared` utilities |
| 02 | `Receivable.transferred` + `hasPendingAdjustment`; `OpeningBalance.carryForwardFrom`; `LateFeePolicy` redefined; `PaymentReversal` report fields; `Payment.allocationStrategy`; receipt uniqueness (gaps allowed); invariants I7/I11 updated |
| 03 | Reversal controls (configurable threshold, default off); teacher login not in release 1 |
| 04 | Metric dictionary, late-fee, allocation (component priority), status, aging, receipt numbering, reversal sections replaced; Model A marked decided |
| 05 | Teacher rule (multiple divisions allowed), historical-teacher resolution |
| 06 | Collection % / Expected references |
| 08 | `domain/billing`; phase notes |
| 09 | Decided BRCs marked, highest-impact list refreshed |
| 10 | Decision register added to traceability |
