# 7 · Fee Calculation Architecture · 8 · Opening Balance Architecture · 11 · Payment Workflow

> **Rule zero:** every final financial number is computed by the backend finance engine. The frontend only *displays* values the API returns (and formats paise → ₹). The "financial preview" in the UI is an API call to the *same* engine — not a re-implementation.

---

## 7. Fee Calculation Architecture

### 7.1 Shape of the engine

`apps/api/src/domain/finance/` — **pure TypeScript, no I/O, no `Date.now()`, no Mongoose.** Inputs/outputs are plain data (integers in paise, `BusinessDate` strings). Services load data, call the engine, persist results inside a transaction.

```
domain/finance/
  money.ts            paise helpers, safe-integer guards, largest-remainder split, bp percent (round-half-up)
  dates.ts            BusinessDate add/diff/compare, IST "today" via injected Clock
  resolve-structure.ts   pick the applicable FeeStructure slot (precedence rules)
  build-assignment.ts    lines snapshot + optional components + overrides → grossAmount
  build-installments.ts  plan template | custom → receivables with component breakdown (rounding-safe)
  opening-balance.ts     OB → single receivable (component OPENING_BALANCE), date rules
  adjustments.ts         resolve discount/concession → per-receivable/component applications
  late-fee.ts            policy + receivable + asOf → penalty receivables to post (idempotent keys)
  allocate.ts            payment amount + open receivables + strategy → allocation rows (+ unallocated)
  reverse.ts             original allocations → exact contra rows
  status.ts              derive paymentStatus / dueStatus / display status / student-year state
  summary.ts             receivables + allocations → summary, nextInstallment, overdue, aging
  aging.ts               asOf bucketing
  invariants.ts          assert*() used by services (defence in depth) and by property tests
```

### 7.2 Metric dictionary (the single definition of every number)

| Metric | Definition (selected academic year & filter scope) | Notes |
|---|---|---|
| **Gross Fee** | Σ `payable` of receivables `kind=INSTALLMENT`, `status≠VOID` | "Applicable Fee" in the preview. Excludes opening balance & penalties. |
| **Opening Balance** | Σ `payable` of `kind=OPENING_BALANCE` | Carried-in dues. **Not new fee.** |
| **Penalties** | Σ `payable` of `kind=PENALTY` | Late fees. |
| **Adjustments** | Σ `adjusted` over all receivables (APPROVED only) | Discounts/concessions/waivers. |
| **Net Receivable** | Gross Fee + Opening Balance + Penalties − Adjustments | = brief: *Opening + Fees + Penalties − Discounts*. |
| **Collected** | Σ `paid` = Σ allocations (net of REVERSAL rows) | Brief's "− Payments − valid adjustments". |
| **Outstanding** | Net Receivable − Collected = Σ `pending` | **SOW §19:** Payable − Paid − Adjustments. |
| **Overdue** | Σ `pending` where `dueDate < today` | Time-dependent → computed at query time. |
| **Due Soon** | Σ `pending` where `today ≤ dueDate ≤ today + dueSoonDays` | `dueSoonDays` setting (BRC-I1). |
| **Not Yet Due** | Σ `pending` where `dueDate > today + dueSoonDays` | |
| **Expected Fees (dashboard)** | **Proposed:** Gross Fee + Penalties − Adjustments (*current-year demand*); Opening Balance shown as a **separate** column/line; "Total Receivable" = Net Receivable | **BRC-I2** — whether "Expected" includes carried-in dues. Both numbers always available. |
| **Collection %** | Collected ÷ Net Receivable (scope) | Alternative "due-to-date efficiency" = collected-on-due ÷ due-to-date (BRC-I2). |
| **Today's / Monthly / Period Collection** | Σ allocations by `postingDate` in period (REVERSAL rows negative on reversal date) | Payment-method/collector reports use `payments` (gross) with a reversal toggle. |
| **Aging bucket** | `daysOverdue = today − dueDate` for pending receivables: *Not due* (≤0) · **0–30**→ days 1–30 · 31–60 · 61–90 · 90+ | **BRC-I2:** whether not-yet-due is shown as its own bucket (proposed) and whether opening balance ages from `dueDate` (proposed = effectiveDate). |
| **Students: Paid / Partial / Unpaid / Overdue / Due soon** | From `student_year_balances` (+ earliestPendingDueDate) | See 7.9. |

Every dashboard tile, report and export uses this dictionary through one query service (`FinanceQueryService`) — reconciliation is a test (`dashboard.expected === Σ(report rows)`).

### 7.3 Core invariants (asserted in code and property tests)

```
payable ≥ 0
adjusted ≥ 0, paid ≥ 0
adjusted + paid ≤ payable                        → pending ≥ 0
pending = payable − adjusted − paid              (per receivable AND per component)
Σ component.payable = receivable.payable  (same for adjusted, paid)
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

### 7.7 Late fee engine

`computePenalties(receivable, policy, asOf) → PenaltyPosting[]` where each posting has a deterministic `periodKey` (`"2026-10-15"` for daily, `"once"` for fixed). A nightly BullMQ job (`penalty.accrue`, 00:30 IST) posts missing periods through the service, inside a transaction, relying on the unique `dedupeKey` ⇒ **running it twice posts nothing new.** Base = receivable `pending` at period end (so paid amounts don't attract penalty). Grace days, cap, applicability to opening balance, compounding = **BRC-F1**. Waiver = `PENALTY_WAIVER` adjustment (needs approval). **Materialising** penalties as real receivables (vs. computing on the fly) is the recommended default: receipts, balances and reminders stay stable and auditable; the setting `lateFee.materialize=false` selects on-the-fly computation for institutions that prefer it.

### 7.8 Payment allocation engine

`allocate({ amount, receivables, strategy, manual? }) → { allocations[], unallocated }` — **pure and deterministic**.

| Strategy (setting `allocation.strategy`) | Order |
|---|---|
| `OLDEST_DUE_FIRST` *(proposed default, BRC-E1)* | by `dueDate` asc → kind priority (`OPENING_BALANCE` → `PENALTY` → `INSTALLMENT`) → `installmentNo` |
| `PENALTY_FIRST` | all penalties, then oldest due |
| `CURRENT_FIRST` | the next due receivable first, then oldest |
| `MANUAL` | caller-supplied `[{receivableId, amount}]`; validated (each ≤ pending; Σ ≤ amount; requires `payment.allocateManual`) |

Within a receivable, the amount splits across components by `allocation.componentSplit` (**BRC-E1**): `PRO_RATA` over remaining component balances (largest-remainder, proposed) or `COMPONENT_PRIORITY` (configured order). Fee-type-wise outstanding (SOW §19) depends on this being recorded per allocation (`componentSplit`).

**Worked examples**
- SOW §17: I1 pending 5,000; I2 pending 15,000; pay 20,000 → I1 5,000 (PAID), I2 15,000 (PAID).
- Pay 12,000 → I1 5,000 (PAID), I2 7,000 (PARTIAL; 8,000 pending).
- SOW §12/§15: I2 = 15,000, pay 10,000 → PARTIAL, 5,000 pending appears in outstanding reports.
- Pay > total pending → rejected `PAYMENT_EXCEEDS_OUTSTANDING` unless `advance.enabled` → excess stored as `unallocatedAmount` (credit) (**BRC-E2/E3**).

### 7.9 Status derivation (two orthogonal dimensions)

Stored per receivable: `paymentStatus ∈ {UNPAID, PARTIAL, PAID, WAIVED, VOID}`.
Derived at read time: `dueStatus ∈ {NOT_DUE, DUE_SOON, OVERDUE}` from `dueDate`, `today`, `dueSoonDays` (only when `pending > 0`).

| SOW §12/§18 term | Rendered when |
|---|---|
| **Pending / Unpaid** | `UNPAID` and not due-soon/overdue |
| **Partially Paid** | `PARTIAL` |
| **Paid** | `PAID` (installment level) |
| **Due Soon** | `pending>0` and `DUE_SOON` (badge combines: "Partially paid · Due soon") |
| **Overdue** | `pending>0` and `OVERDUE` |
| **Fully Settled** | *Student-year level*: every receivable `PAID/WAIVED/VOID`, `pending = 0`, no pending approvals/unapplied credit (**proposed**; BRC-I1) |

Student-year state (`student_year_balances.paymentState` + `earliestPendingDueDate`) → dashboard buckets **Paid / Partial / Unpaid / Overdue / Due soon**; an *Overdue* student is also counted in Partial or Unpaid, so the UI shows overdue as an **overlay filter**, not a mutually exclusive bucket — avoids the SOW §30 example's ambiguity (1,250 + 300 + 200 + 100 = 1,850 treats Overdue as exclusive → **BRC-I1**).

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

### 8.3 Prior-year dues vs. opening balance (critical, BRC-D1)
Two coherent models; the engine supports both, we need the client's choice:

| | **Model A — Aggregate (proposed)** | **Model B — Carry-forward posting** |
|---|---|---|
| Prior-year unpaid fees | stay on the **prior year's** receivables (never mutated) | prior receivables are *closed* by a carry-forward entry; new year gets an `OPENING_BALANCE(source=CARRY_FORWARD)` |
| Student "total outstanding" | Σ across years (receivables are year-tagged) | current-year ledger only |
| Opening balance used for | **migration / external dues only** | migration + every year-end |
| Double-counting risk | none | must close the old receivable exactly once |
| Aging | natural (original due dates) | restarts unless original dates are kept |

**Proposed: Model A.** It never rewrites a prior year, ages correctly, and needs no year-end ritual.

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
2. If approval required → create `PENDING_APPROVAL` (no financial effect yet; UI shows banner "Reversal awaiting approval").
3. On completion (immediately or after approver): in one transaction — for each original allocation insert a **REVERSAL allocation (negative)** with `postingDate = today`; guarded `$inc` restores `paid/pending`/component counters; payment `status=REVERSED`, `uniqueRefKey` unset (re-entry possible); receipt `CANCELLED`; recompute balances; audit `PAYMENT_REVERSED` (+ `RECEIPT_CANCELLED`) with before/after and reason; if the reversal re-opens a receivable that had been cleared before a penalty cut-off, penalties are *not* back-dated automatically (**BRC-E6**).
4. Cascade: if a reversed payment's allocations were later "consumed" by advance-adjustments, those are reversed first, in order (edge case #E17).
5. After commit: cancel nothing in reminders (balance re-opened ⇒ future rules apply again naturally).

### 11.5 Receipts

- Number from `counters` inside the txn — format/series/reset policy configurable (**BRC-G1**); gap-free; unique `(series, receiptNo)`; one per payment.
- Content = SOW §41 field list, all from the **snapshot**; reprints add a "Duplicate copy" marker and increment `printCount`.
- PDF: pdfmake, embedded Noto Sans (₹), logo from object storage, cached in S3 by `hash(snapshot)+templateVersion`; browser print CSS for 80 mm thermal & A5/A4 layouts (**BRC-G1** printer type).
- Cancelled receipts remain retrievable with a visible CANCELLED status and cancellation reason/user/time.

### 11.6 Historical / migrated payments
Entered via import or admission wizard with `source=HISTORICAL|IMPORT`: `paymentDate` in the past, allocated by the same engine (or explicit mapping), **no new receipt number** unless the client wants one (legacy receipt number stored as `reference.note`/`legacyReceiptNo`) — **BRC-D2**. They count in Collected and in date-wise reports on their original date.
