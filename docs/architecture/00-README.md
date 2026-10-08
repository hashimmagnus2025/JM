# Student Fee Management, Collection & Receivables Platform — Architecture Baseline

**Status:** v0.1 — design for review. **No implementation code exists yet.**
**Primary source of truth:** `Student_Fee_Management_System_SOW_1.pdf` (28 pages, 56 sections + one stray commercial page).
**Additional client requirements:** Teacher management, Smart student addition, Opening balance (all incorporated).

---

## 0. How this document set maps to the 21 requested deliverables

| # | Deliverable | Where |
|---|---|---|
| 1 | Complete System Architecture | [01-system-and-stack.md](01-system-and-stack.md) §1 |
| 2 | Technology Stack + Reason for Each | [01-system-and-stack.md](01-system-and-stack.md) §2 |
| 3 | Complete MongoDB Data Model | [02-data-model.md](02-data-model.md) §3 |
| 4 | Entity Relationships | [02-data-model.md](02-data-model.md) §4 |
| 5 | API Architecture | [03-api-and-rbac.md](03-api-and-rbac.md) §5 |
| 6 | RBAC Matrix | [03-api-and-rbac.md](03-api-and-rbac.md) §6 |
| 7 | Fee Calculation Architecture | [04-finance-engine.md](04-finance-engine.md) §7 |
| 8 | Opening Balance Architecture | [04-finance-engine.md](04-finance-engine.md) §8 |
| 9 | Teacher–Division Architecture | [05-academic-and-admission.md](05-academic-and-admission.md) §9 |
| 10 | Student Admission Workflow | [05-academic-and-admission.md](05-academic-and-admission.md) §10 |
| 11 | Payment Workflow | [04-finance-engine.md](04-finance-engine.md) §11 |
| 12 | Reminder Architecture | [06-reminders-dashboard-reports.md](06-reminders-dashboard-reports.md) §12 |
| 13 | Dashboard Architecture | [06-reminders-dashboard-reports.md](06-reminders-dashboard-reports.md) §13 |
| 14 | UI/UX Design System | [07-ux-design-system.md](07-ux-design-system.md) §14 |
| 15 | Complete Module Structure | [08-delivery.md](08-delivery.md) §15 |
| 16 | Development Phases | [08-delivery.md](08-delivery.md) §16 |
| 17 | Testing Strategy | [08-delivery.md](08-delivery.md) §17 |
| 18 | Security Strategy | [08-delivery.md](08-delivery.md) §18 |
| 19 | Performance Strategy | [08-delivery.md](08-delivery.md) §19 |
| 20 | Edge Cases | [09-edge-cases-and-open-rules.md](09-edge-cases-and-open-rules.md) §20 |
| 21 | Business Rules Requiring Confirmation | [09-edge-cases-and-open-rules.md](09-edge-cases-and-open-rules.md) §21 |
| — | SOW §1–§56 → design traceability | [10-sow-traceability.md](10-sow-traceability.md) |

---

## 0.1 What we are building (one paragraph)

A multi-year **receivables system for schools**: every rupee a student owes (fees, opening balance, penalties) is a *receivable*; every rupee received is an immutable *payment* that is *allocated* to receivables; adjustments (discounts, waivers) reduce receivables without erasing the original charge. **Outstanding is always derived** from these append-only facts by one pure, heavily tested finance engine on the backend. Academic structure (year → class → division → teacher assignment → enrollment) is **effective-dated and never overwritten**, so any past year can be reproduced exactly.

## 0.2 The 14 decisions that shape everything (ADR summary)

| # | Decision | Why it matters |
|---|---|---|
| D1 | **Modular monolith** (Express 5 API) + **separate worker process from the same codebase** (BullMQ). Not microservices. | Financial writes need multi-document ACID transactions; one VPS in the SOW commercial page; one team. |
| D2 | **Receivable-based sub-ledger.** One `receivables` collection holds every payable unit (installment, opening balance, penalty). Payments are allocated to receivables through immutable `payment_allocations`. | One uniform path for outstanding, aging, reminders, reports. Opening balance cannot "accidentally create a fee" because it is a different `kind` with its own component and is excluded from gross fee by definition. |
| D3 | **Append-only finance.** Payments, allocations, receipts, reversals, audit are never updated/deleted. Reversal = contra-allocation rows + status flag. | SOW §42; "never silently modify financial history". |
| D4 | **Money = integer paise** (never floats/Decimal in JS). Percentages in basis points. Remainders distributed by largest-remainder; property-tested. | Zero rounding drift. |
| D5 | **Business dates are `YYYY-MM-DD` strings in the institution time zone (Asia/Kolkata)**; timestamps are UTC `Date`. Injectable `Clock`. | Aging/overdue off-by-one bugs at midnight/UTC are the #1 source of wrong "overdue" figures. |
| D6 | **Divisions are year-scoped** (`Division = year + class + name`). Teacher assignment and enrollment reference the division. | "Class 5-A in 2025-26" is a permanent historical fact, renaming/closing in 2026-27 can't alter it. |
| D7 | **Enrollment is the academic truth**; `student.current` is a rebuildable projection for fast list/search. | SOW §7 lists "Current class/division" on the student, but §8 forbids overwriting history. |
| D8 | **Fee structures are immutable once published** (versioned). A student's `fee_assignment` snapshots the version + lines. | SOW §11: changing 2026-27 must not alter 2025-26; also protects mid-year edits. |
| D9 | **Teacher assignments are effective-dated rows**; "change teacher" closes one row and opens another in one transaction; DB partial unique index enforces one current class teacher per division. | Historical teacher mapping preserved. |
| D10 | **Idempotency + guarded updates + unique indexes** for every money-moving command (payment, reversal, opening balance, admission, import commit). | Double-click / retry / two cashiers can never double-post or overpay. |
| D11 | **One query layer** serves dashboard, reports, exports, drill-downs, and a written **metric dictionary** defines each number once. | KPI tile, report and Excel export always reconcile. |
| D12 | **Permissions are code-defined, roles are data, enforcement is backend-only** (+ data scope for class teachers). | "Never trust frontend permissions." |
| D13 | **Business rules that the SOW leaves open are strategy/config in the engine**, with a *proposed default flagged as BRC-nn*, not baked in. | We do not silently decide financial policy — answering a BRC changes a setting, not the code. |
| D14 | **Imports are two-phase** (stage → validate → human-confirmed commit, chunked, idempotent per row). | SOW §45 + "require confirmation before committing financial data". |

## 0.3 Observations on the SOW itself (read before approving the design)

1. **Illustrative numbers are not fully consistent.** §5 and §6 reconcile exactly for Class 10 (40+42+39+39 = 160 students; ₹20L+21L+19.5L+19.5L = ₹80L expected; ₹68L collected; ₹12L outstanding; 85%). §32 shows Class 10 at 85% with **₹7.5L** outstanding — contradicts §5 (₹12L). We treat §5/§6/§35/§31 (which add up) as **acceptance-test fixtures** and ignore §32's outstanding.
2. **Two overlapping status vocabularies:** §12 uses *Pending/Partial/Paid*, §18 uses *Paid/Partially Paid/Unpaid/Due Soon/Overdue/Fully Settled*, and the brief adds *Pending*. "Paid" vs "Fully Settled" is never defined → **BRC-I1**. Design models status as two orthogonal dimensions (payment state × due state) so any vocabulary can be rendered without re-engineering.
3. **Page 28 is a stray commercial page ("17. Cost Estimate")** — not part of §1–§56. It states: ₹50,000 development, 45–60 working days, ₹6,000/month VPS, **₹120 per active student per year**, third-party costs extra. Consequences: (a) deployment is sized for **one VPS** (design in §1.6); (b) "active student" becomes a *billing-relevant* definition → **BRC-K1**; (c) **scope risk:** the SOW + the brief's 20 phases is far larger than 45–60 working days of effort. See §16.0 in [08-delivery.md](08-delivery.md) for a recommended MVP cut — this is a commercial conversation to have *before* build, not a technical one.
4. **SOW §52 lists multi-branch, parent portal, payment gateway, hostel/transport management as *future*.** We keep `institutionId` on every document and a clean port/adapter boundary for payments & notifications so these are additive, but we do **not** build them.
5. **§55 lists 40 pre-development confirmation points.** Every one of them is either answered by a design choice here or captured in [§21](09-edge-cases-and-open-rules.md) with a recommended default.

## 0.4 Conventions used in these documents

- `BRC-xx` = **BUSINESS RULE REQUIRES CONFIRMATION** (full list in §21).
- Money examples are shown in rupees for readability; **storage is integer paise**.
- TypeScript-style blocks in the data model are *design notation*, not final source.
- "Receivable" is the engineering name; the UI says **"Dues"** / **"Installment"** / **"Opening balance"** / **"Late fee"** (no technical terms to staff — see §14).

## 0.5 Next step

Review §21 (the open rules). I can proceed with Phase 1 immediately using the proposed defaults — they are isolated behind settings — but anything touching **allocation order, carry-forward, late fees, reversal approval and receipt numbering** should be confirmed before Phases 9–12 are finished.
