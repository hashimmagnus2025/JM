# 7 · Fee Calculation Architecture · 8 · Opening Balance Architecture · 11 · Payment Workflow

> **Rule zero:** every final financial number is computed by the backend finance engine. The frontend only *displays* values the API returns (and formats paise → ₹). The "financial preview" in the UI is an API call to the *same* engine — not a re-implementation.

---

## 7. Fee Calculation Architecture

### 7.1 Shape of the engine

`apps/api/src/domain/finance/` — **pure TypeScript, no I/O, no `Date.now()`, no Mongoose.** Money and business-date primitives live in `packages/shared` (also pure). Inputs/outputs are plain data (integer paise, `BusinessDate` strings). Services load data, call the engine, persist the result inside a transaction.

```
packages/shared/        money.ts (paise, BigInt-safe percent, largest-remainder splits, INR format) · dates.ts (BusinessDate, IST Clock) · canonical.ts
domain/finance/
  types.ts errors.ts invariants.ts
  fee-structure.ts       resolve the applicable structure slot (precedence)
  fee-version.ts         content hash + immutability guard for published versions
  build-installments.ts  plan | custom | full → receivables with component breakdown (rounding-safe)
  opening-balance.ts     opening balance → one receivable (never gross fee)
  carry-forward.ts       manual, audited carry-forward plan (never automatic)
  adjustments.ts         discount/concession → per-receivable/component applications
  late-fee.ts            policy + parent receivable + asOf → penalty postings (idempotent, append-only)
  allocate.ts            payment → allocations (OLDEST_DUE_FIRST, MANUAL), component priority, apply
  reversal.ts            compensating allocations + reversal report row
  reversal-policy.ts     threshold-driven approval decision (no hard-coded amount)
  payment-rules.ts       zero/invalid/overpayment validation
  status.ts              paid / partial / due soon / overdue / fully settled
  summary.ts             metrics (expected, collected, collection %, by year, all years)
  aging.ts               0–30 / 31–60 / 61–90 / 90+ by original due date
  receipt-number.ts      REC-2026-000001 formatting + scope key
  preview.ts             buildFeePreview(): the ONE function used by both preview and admission save
```

### 7.2 Metric dictionary (the single definition of every number)

| Metric | Definition (selected academic year & filter scope) | Notes |
|---|---|---|
| **Gross Fee** | Σ `payable` of receivables `kind=INSTALLMENT`, `status≠VOID` | "Applicable Fee" in the preview. Excludes opening balance & penalties. |
| **Opening Balance** | Σ `payable` of `kind=OPENING_BALANCE` | Carried-in dues. **Not new fee.** |
| **Penalties** | Σ `payable` of `kind=PENALTY` | Late fees. |
| **Adjustments** | Σ `adjusted` over all receivables (APPROVED only) | Discounts/concessions/waivers. |
| **Transferred (carried forward)** | Σ `transferred` | Manual carry-forward only (BRC-D1). Not a discount, not collected. |
| **Net Receivable** | Σ(`payable − adjusted − transferred`) over all receivables (= Gross Fee + Opening Balance + Penalties − Adjustments − Transferred) | = brief: *Opening + Fees + Penalties − Discounts*. |
| **Collected** | Σ `paid` = Σ allocations (net of REVERSAL rows) | Brief's "− Payments − valid adjustments". |
| **Outstanding** | Net Receivable − Collected = Σ `pending` | **SOW §19:** Payable − Paid − Adjustments. |
| **Overdue** | Σ `pending` where `dueDate < today` | Time-dependent → computed at query time. |
| **Due Soon** | Σ `pending` where `today ≤ dueDate ≤ today + dueSoonDays` | `dueSoonDays` setting (BRC-I1). |
| **Not Yet Due** | Σ `pending` where `dueDate > today + dueSoonDays` | |
| **Expected Fees** | Σ(`payable − adjusted`) over `kind=INSTALLMENT` receivables in scope — the applicable fee obligation **after approved discounts**. **Opening balance is excluded and shown separately; penalties are excluded by default** (setting `metrics.expectedIncludesPenalties`). | **Decided (BRC-I2); CL-10.** |
| **Collection %** | Collected ÷ Expected × 100, where *Collected* = Σ`paid` over the **same** installment receivables (so it cannot exceed 100 %). Computed in basis points; 0 when Expected = 0. Opening-balance and penalty collections have their own lines. | **Decided (BRC-I2).** |
| **Today's / Monthly / Period Collection** | Σ allocations by `postingDate` in period (REVERSAL rows negative on reversal date) | Payment-method/collector reports use `payments` (gross) with a reversal toggle. |
| **Aging bucket** | `days = today − originalDueDate` for `pending>0` receivables: **0–30 · 31–60 · 61–90 · 90+** (boundaries configurable), future-dated → *Not yet due*. Opening balance ages from its configured effective/due date. | **Decided (BRC-I2); CL-11** (0–30 includes due-today; *Overdue* KPI = `dueDate < today`). |
| **Students: Paid / Partial / Unpaid / Overdue / Due soon** | From `student_year_balances` (+ earliestPendingDueDate) | See 7.9. |

Every dashboard tile, report and export uses this dictionary through one query service (`FinanceQueryService`) — reconciliation is a test (`dashboard.expected === Σ(report rows)`).

### 7.3 Core invariants (asserted in code and property tests)

```
payable ≥ 0
adjusted ≥ 0, transferred ≥ 0, paid ≥ 0
adjusted + transferred + paid ≤ payable      → pending ≥ 0
pending = payable − adjusted − transferred − paid   (per receivable AND per component)
Σ component.payable = receivable.payable  (same for adjusted, transferred, paid)
Σ installments.payable (per component) = assignment line amount
Σ allocations(payment) + unallocated = payment.amount
reversal(allocations(p)) ∘ allocations(p) = identity on every touched receivable
```

### 7.4 Fee structure resolution (precedence)

Candidates for `(year, class, division, category)` are the structures whose slot fields are either equal **or null (wildcard)**. Most specific wins, deterministic order:

1. `(class, division, category)` 2. `(class, division, *)` 3. `(class, *, category)` 4. `(class, *, *)`

No match → `422 NO_FEE_STRUCTURE` (the wizard shows *"No fee structure published for Class 5 · General · 2026-27 — contact Accounts"* and blocks Step 4). Ambiguity is impossible by the unique slot index. Only the structure's **PUBLISHED current version** is eligible. **(BRC-C1** confirms precedence; the function is a strategy so a different rule is a config change.)

### 7.5 Installment generation

Input: version `lines` (+ optional-component selection), chosen `plan` (or `FULL`, or `CUSTOM`), `asOf`.

For each component *c* with amount *A_c* and schedule entries *s_k* for installments *k = 1…n*:
- `PERCENT_BP` → `floor(A_c × bp / 10000)`; `FIXED` → value; `REMAINDER` → `A_c − Σ(others)`.
- If no explicit schedule: split by **largest-remainder** over the installment weights (default equal), so `Σ_k = A_c` exactly; **leftover paise go to the last installment** (**BRC-C4** to confirm first vs last).
- Installment *k* `payable = Σ_c part(c,k)`; `components[]` carry the breakdown (installment-specific components, SOW §12).
- `CUSTOM` plan: user supplies `{dueDate, amount}` list (or per-component) → validated `Σ = grossAmount`; only users with `feeAssignment.manage`.
- `FULL`: one installment, due date = first plan due date (or admission date if later — **BRC-B4**).
- Dedupe key per receivable (`FEE_ASSIGNMENT:<id>:<no>`) ⇒ regenerating is idempotent.

**Mid-year admission (BRC-B4):** installments with `dueDate < admissionDate` are *generated as overdue* by default **or** consolidated into the first upcoming installment — a setting, not hard-coded.

### 7.6 Adjustments (discount / concession / scholarship / waiver)

`resolveAdjustment(request, receivables)` returns `applications[]` that sum **exactly** to the requested amount:
- `FIXED` (paise) or `PERCENT_BP` of a *basis* (`TOTAL_FEE`, one `COMPONENT`, one `RECEIVABLE`).
- Distribution: `PROPORTIONAL` (largest-remainder) · `EARLIEST_FIRST` · `LATEST_FIRST` · `SPECIFIC` (**BRC-F2**).
- Caps: cannot exceed `payable − paid − already adjusted` of the target; may not reduce below what is already paid (that would be a *refund*, out of scope → `422 ADJUSTMENT_EXCEEDS_PAYABLE`).
- Applied only when `APPROVED`; original `payable` untouched ⇒ **"original fee information remains traceable"** (SOW §39).

### 7.7 Late fee engine (decided: BRC-F1)

**Policy** (versioned): `mode ∈ {FIXED, PER_DAY, PERCENT}` · `graceDays` (default 0) · `capPaise` (total per parent receivable) · `appliesToKinds` (default installments only) · `applyToOpeningBalance` (default **false**) · `installmentOverrides[installmentNo]` for installment-specific rules · `effectiveFrom/To`.

`computePenaltyPostings({ parent, policy, asOf, paidEvents, existingPostings }) → PenaltyPosting[]`:
- First penalty day = `dueDate + graceDays + 1`. `FIXED` → one posting; `PERCENT` → one posting of `bp × pending-on-first-penalty-day`; `PER_DAY` → one posting per overdue day on which the parent still has a balance. Postings are clipped by the remaining cap and skipped if their deterministic `periodKey` already exists ⇒ **running twice posts nothing new**.
- `pending-on-day d` is reconstructed from the parent's payable/adjusted/transferred minus allocations posted on or before `d` (`paidEvents`), so a late-running job charges exactly what an on-time job would have.
- Never on a `PENALTY`; on `OPENING_BALANCE` only if configured. Penalties are **separate `PENALTY` receivables** (component `LATE_FEE`, `parentReceivableId`, `policyId`, `policyVersion`). **Once posted they are history:** later policy versions affect only days on/after their `effectiveFrom`; receipts are snapshots and never recomputed.
- Posting is done by the nightly job (`penalty.accrue`) inside a transaction; unique `dedupeKey` is the DB-level guarantee. Waiver = `PENALTY_WAIVER` adjustment (approval required). Interpretation notes: CL-03, CL-04, CL-05.

### 7.8 Payment allocation engine (decided: BRC-E1)

`allocatePayment({ amount, receivables, today, strategy, componentPriority, mode, manual?, eligibleReceivableIds?, advanceEnabled }) → { allocations[], unallocated }` — **pure and deterministic**. Receivables of **all academic years** of the student are candidates (Model A, BRC-D1); each allocation records the receivable's own year.

| Strategy (setting `allocation.strategy`) | Order |
|---|---|
| **`OLDEST_DUE_FIRST`** *(decided default)* | **Tier 0 — overdue** (`dueDate < today`): `dueDate` ↑ → kind rank (`OPENING_BALANCE`, `PENALTY`, `INSTALLMENT`) → installment no. → id. **Tier 1 — not yet overdue:** kind rank → `dueDate` ↑ → installment no. → id. (⇒ ① oldest overdue ② opening balance ③ penalty ④ oldest pending installment ⑤ newer installments; CL-01) |
| `MANUAL` | caller-supplied `[{receivableId, amount}]`; each ≤ that receivable's pending; Σ must equal the payment (or the remainder is advance credit when enabled); requires `payment.allocateManual` |
| *(future)* `PENALTY_FIRST`, `CURRENT_FIRST` | registry slots — strategy is a setting; the strategy used is stored on every payment (`allocationStrategy`) |

**Within one receivable:** amount is applied component-by-component in `allocation.componentPriority` order (codes not listed follow in the receivable's own component order) — **not pro-rata** (CL-02: priority list to be supplied). Each allocation row stores `componentSplit`, which feeds fee-type-wise outstanding (SOW §19).

**Every allocation is an immutable row** (`payment_allocations`); reversals add negative rows (§11.4).


**Worked examples**
- SOW §17: I1 pending 5,000; I2 pending 15,000; pay 20,000 → I1 5,000 (PAID), I2 15,000 (PAID).
- Pay 12,000 → I1 5,000 (PAID), I2 7,000 (PARTIAL; 8,000 pending).
- SOW §12/§15: I2 = 15,000, pay 10,000 → PARTIAL, 5,000 pending appears in outstanding reports.
- Pay > total pending → rejected `PAYMENT_EXCEEDS_OUTSTANDING` unless `advance.enabled` → excess stored as `unallocatedAmount` (credit) (**BRC-E2/E3**).

### 7.9 Status derivation (decided: BRC-I1)

Stored per receivable: `paymentStatus ∈ {UNPAID, PARTIAL, PAID, WAIVED, VOID}` (engine-written).
Derived at read time: `dueStatus ∈ {NOT_DUE, DUE_SOON, OVERDUE}` from `dueDate`, `today`, `dueSoonDays` (**default 7**, setting `status.dueSoonDays`) — only when `pending > 0`.

| SOW term | Definition implemented |
|---|---|
| **Pending / Unpaid** | `pending > 0`, nothing paid, not due-soon/overdue |
| **Partially Paid** | `0 < paid` and `pending > 0` |
| **Paid** | `pending = 0` **and no active pending adjustment on that receivable** |
| *(zero balance but a pending adjustment exists)* | `PENDING_ADJUSTMENT` — never shown as Paid (CL-09) |
| **Due Soon** | `pending > 0` and `dueDate − dueSoonDays ≤ today ≤ dueDate` |
| **Overdue** | `pending > 0` and `dueDate < today` |
| **Fully Settled** | the **complete obligation of the student/fee scope** (one academic year, or all years) is cleared: every non-void receivable has `pending = 0` and no pending adjustment (service adds: no pending reversal) |

Student-year state (`student_year_balances.paymentState` + `earliestPendingDueDate`) → dashboard buckets **Paid / Partial / Unpaid / Overdue / Due soon**; overdue is an **overlay** (an overdue student is also Partial or Unpaid) — SOW §30's exclusive example is therefore shown as an overlay filter (BRC-I1).


### 7.10 Outstanding formula reconciliation

| Source | Formula | Engine |
|---|---|---|
| SOW §19 | Total Payable − Total Paid − Applicable Adjustments = Outstanding | Σ(payable) − Σ(paid) − Σ(adjusted) |
| Brief | Opening + Fees + Penalties − Discounts − Payments − Valid Adjustments | `OB.payable + Gross + Penalties − adjusted − paid` — identical, because discounts *are* adjustments |

### 7.11 Worked example — the "FEE SUMMARY" preview (verified arithmetic)

Student admitted mid-year on **8 Oct 2026**, Class 5-A, General, plan "4 installments"; migrating from another system.

| Receivable | Due | Payable | Adjusted | Paid | Pending | Status @ 8 Oct 2026 |
|---|---|---:|---:|---:|---:|---|
| Opening balance (effective 1 Apr) | 01 Apr | 10,000 | 0 | 10,000 | 0 | Paid |
| Installment 1 | 10 Apr | 12,500 | 0 | 10,000 | **2,500** | Partially paid · **Overdue 181 d** (90+) |
| Installment 2 | 10 Jul | 12,500 | 0 | 0 | **12,500** | **Overdue 90 d** (61–90) |
| Installment 3 | 10 Oct | 12,500 | 0 | 0 | **12,500** | **Due soon** (2 d) |
| Installment 4 | 10 Jan | 12,500 | **5,000** (concession, latest-first) | 0 | **7,500** | Not due |
| **Total** | | **60,000** | **5,000** | **20,000** | **35,000** | |

```
FEE SUMMARY
 Applicable Fee      ₹50,000      (4 × 12,500)       ← Gross Fee
 Opening Balance     ₹10,000                         ← NOT added to fee
 Concession         −₹5,000
 Already Paid       −₹20,000      (₹10,000 → opening balance, ₹10,000 → Inst. 1 under OLDEST_DUE_FIRST)
 ───────────────────────────────
 CURRENT OUTSTANDING ₹35,000      = 50,000 + 10,000 − 5,000 − 20,000 ✔
 Overdue ₹15,000 · Next installment ₹12,500 due 10 Oct 2026 (Due soon)
```
This exact case (and the SOW's §5/§6, §12, §17, §31, §35 numbers) become **golden tests**.

### 7.12 Student-year balance projection & reconciliation

`student_year_balances` is **recomputed from the student's receivables inside the same transaction** that changes them (≤ ~12 rows; a `$group`, not an increment ⇒ no drift). A nightly job (`finance.reconcile`) verifies I7/I9 for the whole institution (receivable counters vs allocations, balances vs receivables) and raises a Sentry alert + an in-app notification on any difference; it never auto-corrects financial data silently — it reports.

---

## 8. Opening Balance Architecture

### 8.1 Definition & purpose
A **carried-in amount a student already owes** when they enter the system (migration) or enter a year with prior dues. It is **a receivable, not a fee**.

### 8.2 Data & behaviour

| Aspect | Design |
|---|---|
| Record | `opening_balances` document: amount, academic year, effective date, source (`MIGRATION`/`MANUAL`/`ADMISSION`/`CARRY_FORWARD`), reason, remarks, created by/at. |
| Financial effect | Exactly **one** `Receivable(kind=OPENING_BALANCE)` with one component `OPENING_BALANCE` (system component), `dueDate = effectiveDate` unless set otherwise, created **in the same transaction**. |
| What it must NOT do | Not create a `FeeAssignment` line, not change `grossFee`, not appear as "Expected fee". Engine test: *importing/creating an OB changes Net Receivable by exactly +amount and Gross Fee by 0.* |
| Uniqueness | ≤ 1 ACTIVE OB per student × year (partial unique index). A correction is **reverse + create new**, both audited, linked by `reason`. (**BRC-D1:** do we need multiple OBs per year?) |
| Allocation | Participates in allocation like any receivable; default priority puts it first (oldest). |
| Reversal | `POST /opening-balances/:id/reverse` (reason required, `openingBalance.reverse`): allowed only if `paid = 0`; otherwise the paid part must be reversed first (payment reversal) — never silently shrinks. Voids the receivable (`paymentStatus=VOID`), keeps both rows. |
| Aging / overdue | Ages from its `dueDate` (proposed = effectiveDate) — **BRC-D1/I2**. |
| Visibility | Student 360 (Fees tab: own line + header chip), Fee Summary card, Financial History timeline, Outstanding/Overdue/Aging reports (own column + filter `kind`), **Opening Balance Report**, Audit Log (CREATED / REVERSED with before/after), Import preview. |
| Import | Migration import validates: student exists, year exists, amount > 0, effective date within/before the year, **no ACTIVE OB already** (→ `DUPLICATE`), batch reconciliation total shown before commit. |

### 8.3 Prior-year dues vs. opening balance — **DECIDED (BRC-D1): keep unpaid dues in their original academic year**

- Unpaid fees of 2025-26 **stay on 2025-26 receivables**; 2026-27 gets only its own new fees. Nothing is converted to an opening balance automatically, ever.
- Student financial history shows `2025-26 outstanding ₹10,000` and `2026-27 fee ₹50,000` separately, plus a labelled **cross-year total receivable** (`summarizeAll`). Payment allocation spans years oldest-first (§7.8); every allocation keeps the receivable's own year.
- **Opening balance** is therefore used for **migration / external dues** and for an *explicit* carry-forward only.
- **Explicit carry-forward** (optional, manual, permission-gated, reason mandatory, audited): `planCarryForward` moves the pending amount of chosen source receivables into `transferred` and creates one `OPENING_BALANCE(source=CARRY_FORWARD, carryForwardFrom=[…])` in the target year. Total outstanding is unchanged; the source year's Collected is unchanged; the transfer is neither a discount nor a collection (CL-12).


### 8.4 Tests (see §17)
OB creation (+amount, gross unchanged) · duplicate OB blocked · OB + installments + concession arithmetic (§7.11) · partial payment allocation to OB first · OB reversal blocked when paid · import commit twice → single OB · audit entry present · aging bucket of OB.

---

## 11. Payment Workflow

### 11.1 Staff workflow (UI)

```
Global search / Cmd+K  →  Student (collection view)
  │   shows: identity + class/division/teacher, Opening balance, Dues table (selectable rows),
  │          Paid-to-date, Outstanding, Overdue, Credit
  ▼
Select dues  (default: all overdue + next due; click rows to change)       ← "Select Fee/Installment"
  ▼
Enter amount  (default = Σ selected pending; editable; ≤ outstanding unless advance enabled)
  ▼
Allocation preview (server)  — AUTO (default)  |  MANUAL (only if permitted)
  ▼
Method (Cash/UPI/Bank/Cheque/Card/Other) → method-specific fields:
   UPI/Bank/Card: reference required · Cheque: number + bank + date · Cash: none
  ▼
Confirm dialog (amount, student, allocation summary, "Balance after")  → [Confirm payment] (disabled while pending)
  ▼
Success: receipt number, [Print] [Download PDF] [WhatsApp/Email (if integrated)] [Collect another]; balance refreshed
```

### 11.2 Backend command `POST /payments` (single transaction)

```
0.  authenticate · authorize(payment.collect) · validate · idempotency lookup (replay → return original)
1.  load student (scope check), open receivables FOR UPDATE-equivalent: read inside txn (snapshot)
2.  rule checks:  student valid & ACTIVE-or-allowed · academic year not CLOSED (else override perm) ·
                  amount > 0 & safe integer · method enabled · backdate window · reference rules
                  (unique reference key; cheque no+bank) · soft-duplicate heuristic
                  (same student+amount+method within 10 min → 409 POSSIBLE_DUPLICATE unless confirmDuplicate=true)
3.  engine.allocate()  → allocations[] + unallocated
      reject if Σ > pending (PAYMENT_EXCEEDS_OUTSTANDING) unless advance.enabled
4.  insert Payment (paymentNo from counter) with idempotencyKey / uniqueRefKey   ← unique indexes are the last line of defence
5.  for each allocation:
      updateOne({_id, version, pending: {$gte: x}},                           ← GUARDED: fails if a concurrent
                {$inc: {paid: x, pending: -x, "components.$[c].paid": …, version: 1},   payment already consumed it
                 $set: {paymentStatus}})
      matchedCount≠1 → abort txn → retry (bounded) with fresh state or 409 RECEIVABLE_VERSION_CONFLICT
      insert PaymentAllocation (immutable)
6.  recompute StudentYearBalance(s)
7.  create Receipt (receiptNo from counter, snapshot incl. previous/remaining balance)
8.  AuditLog: PAYMENT_CREATED, RECEIPT_GENERATED (same txn, hash-chained)
9.  commit
10. afterCommit: bump finance cache version · cancel QUEUED reminders of fully-paid receivables ·
                 enqueue receipt-PDF warm-up (optional) · optional receipt send (WhatsApp/Email)
11. respond { payment, receipt, allocations, studentBalance }
```

**Concurrency guarantees:** two cashiers paying the same installment concurrently → the second guarded `$inc` fails → retried against fresh state → either allocates the remaining amount or returns `PAYMENT_EXCEEDS_OUTSTANDING`. **Double-click / network retry** → same `Idempotency-Key` → one payment. **Same UPI ref twice** → unique index → `409 DUPLICATE_TRANSACTION_REF`.

### 11.3 State machines

```
Payment:   POSTED ──(reversal COMPLETED)──► REVERSED         (terminal; one reversal only)
Reversal:  PENDING_APPROVAL ──approve──► COMPLETED
                          └──reject───► REJECTED (payment stays POSTED)
           (no approval required: created directly as COMPLETED)
Receipt:   ISSUED ──(payment reversed)──► CANCELLED           (number retained, "CANCELLED" watermark)
Receivable.paymentStatus: UNPAID ⇄ PARTIAL ⇄ PAID  (driven only by engine writes) ; WAIVED / VOID terminal
```

### 11.4 Reversal workflow (`POST /payments/:id/reverse`)

1. Requires `payment.reverse`, reason code + text (mandatory), original payment `POSTED`.
2. If `reversal.approval.thresholdPaise` is set and the payment amount ≥ threshold → create `PENDING_APPROVAL` (no financial effect yet; UI shows banner "Reversal awaiting approval"); approver must be a different user with `payment.reverseApprove`. **Default: threshold unset → no approval step.**
3. On completion (immediately or after approver): in one transaction — for each original allocation insert a **REVERSAL allocation (negative)** with `postingDate = today`; guarded `$inc` restores `paid/pending`/component counters; payment `status=REVERSED`, `uniqueRefKey` unset (re-entry possible); receipt `CANCELLED`; recompute balances; audit `PAYMENT_REVERSED` (+ `RECEIPT_CANCELLED`) with before/after and reason; if the reversal re-opens a receivable that had been cleared before a penalty cut-off, penalties are *not* back-dated automatically (**BRC-E6**).
4. Cascade: if a reversed payment's allocations were later "consumed" by advance-adjustments, those are reversed first, in order (edge case #E17).
5. After commit: cancel nothing in reminders (balance re-opened ⇒ future rules apply again naturally).

### 11.5 Receipts

- Number = `REC-{scopeYear}-{seq:000000}` (decided BRC-G1) from `counters` inside the txn; prefix and scope (`ACADEMIC_YEAR` | `CALENDAR_YEAR` | `FINANCIAL_YEAR` | `NONE`) are settings; **unique, never reused, gaps allowed**; clients can never supply a number; one receipt per payment; never renumbered.
- Content = SOW §41 field list, all from the **snapshot**; reprints add a "Duplicate copy" marker and increment `printCount`.
- PDF: pdfmake, embedded Noto Sans (₹), logo from object storage, cached in S3 by `hash(snapshot)+templateVersion`; browser print CSS for 80 mm thermal & A5/A4 layouts (**BRC-G1** printer type).
- Cancelled receipts remain retrievable with a visible CANCELLED status and cancellation reason/user/time.

### 11.6 Historical / migrated payments
Entered via import or admission wizard with `source=HISTORICAL|IMPORT`: `paymentDate` in the past, allocated by the same engine (or explicit mapping), **no new receipt number** unless the client wants one (legacy receipt number stored as `reference.note`/`legacyReceiptNo`) — **BRC-D2**. They count in Collected and in date-wise reports on their original date.
