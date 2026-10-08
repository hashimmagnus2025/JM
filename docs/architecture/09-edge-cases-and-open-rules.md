# 20 · Edge Cases · 21 · Business Rules Requiring Confirmation

---

## 20. Edge Cases (each maps to a test or an explicit decision)

### Academic structure & teachers
| # | Case | Handling |
|---|---|---|
| E1 | Two admins assign a class teacher to the same division simultaneously | Partial unique index → one wins, other gets `409 DIVISION_ALREADY_HAS_TEACHER`. |
| E2 | Teacher deactivated while assigned | Blocked, or "deactivate + choose replacement" in one transaction. |
| E3 | Teacher changed mid-year; report "as of" a date before the change | Effective-dated rows return the earlier teacher; BRC-B6 sets default attribution. |
| E4 | Division deleted/renamed in the next year | Divisions are year-scoped: old year untouched; deletion only when no enrollment/assignment/structure references it, else archive. |
| E5 | Academic year date overlap, two "current" years, closing a year with pending approvals | Service validation + partial unique index; close blocked with itemised reasons. |
| E6 | Division at capacity | Soft warning / hard block per setting (BRC-A2). |
| E7 | Class with a single section / streams in Class 11–12 (Science/Commerce) | Division name "A"/"Main"; streams modelled as divisions (or `stream` attribute) — BRC-A3. |
| E8 | Class sequence edited after students exist | Allowed (cosmetic) but promotion mapping preview recomputed; sequence uniqueness enforced. |

### Students, enrollment, promotion
| # | Case | Handling |
|---|---|---|
| E9 | Duplicate student (same name+DOB+guardian mobile) / duplicate admission number | Heuristic warning with acknowledge-and-reason; admission no. hard unique. |
| E10 | Siblings sharing a mobile number | Mobile is *not* unique; shown as sibling hint (BRC-B2 concession). |
| E11 | Student re-admitted after withdrawal | `READMISSION` enrollment; same student record; prior dues stay on their year (Model A). |
| E12 | Promotion when student has unpaid prior-year dues | Policy allow/warn/block (BRC-B5); dues never lost or double-counted (Model A/B, BRC-D1). |
| E13 | Promotion batch crashes halfway | Per-student transactions + unique `(student, year)` index → resume processes only the remainder; batch `PARTIAL`. |
| E14 | Student promoted to a year with no fee structure for their slot | Row warning; promotion allowed *without* fee assignment (flagged "Fees pending") or blocked per setting. |
| E15 | Class/division changed mid-year | Division change: new enrollment row, receivable dimensions synced, amounts untouched. Class change: blocked unless authorised correction (fee re-assignment) — BRC-C3. |
| E16 | Student leaves (TC/withdrawal) with future installments | Status change requires choice: *keep dues*, *void unbilled future installments* (reason, approval) — BRC-B3. Past dues remain. |

### Payments & reversals
| # | Case | Handling |
|---|---|---|
| **E17** | **Reversing a payment whose allocations were later "used" by advance-adjustments** | Reverse dependents first in reverse chronological order inside one transaction; if impossible (period closed) → blocked with explanation. |
| E18 | Double-click / retry / flaky network on Confirm | Idempotency key → exactly one payment & receipt. |
| E19 | Two cashiers collect for the same installment at once | Guarded `$inc` (`pending ≥ x`) + retry → second gets the remainder or `PAYMENT_EXCEEDS_OUTSTANDING`. |
| E20 | Payment > outstanding | Rejected, unless advance enabled → credit (BRC-E2/E3). |
| E21 | Same UPI/bank reference reused (typo vs fraud) | Hard block with link to the existing receipt; after *reversal* the ref is reusable (corrected re-entry). |
| E22 | Cheque dishonoured later | Modelled as a reversal with reason `CHEQUE_BOUNCE`; optional bounce charge → ad-hoc receivable (BRC-E4). |
| E23 | Back-dated payment into a closed month/year | Needs `payment.backdate` (+ `academicYear.override`); flagged on receipt/report. |
| E24 | Reversal requested twice / concurrently | Unique `payment_reversals.paymentId` → one wins. |
| E25 | Reversal re-opens an installment that was cleared before its late-fee date | No automatic retro-penalty; admin may post/waive manually — BRC-E6. |
| E26 | Receipt number gap after failed payment | Counter increment is inside the transaction → rollback leaves no gap. |
| E27 | Receipt reprint years later after student renamed / class changed | Prints from immutable snapshot; "Duplicate copy" marker. |
| E28 | Payment for a student in a CLOSED year | Blocked → override flow. |
| E29 | Allocation to opening balance + penalties + installments in one payment | Strategy order; component split pro-rata; per-component accounting in `componentSplit`. |
| E30 | Advance credit exists and a new year's fees are generated | Auto-apply (setting) creates `ADVANCE_ADJUSTMENT` allocations; never silently — shown on receipt/statement. |

### Fees, installments, adjustments, penalties
| # | Case | Handling |
|---|---|---|
| E31 | Fee structure republished after students were assigned | Existing assignments keep their version; "Re-price existing students" is an explicit, previewed, audited bulk action producing delta receivables/adjustments — BRC-C3. |
| E32 | Installment amounts don't divide evenly | Largest-remainder; leftover paise placement BRC-C4; Σ always exact. |
| E33 | Due date moved after reminders were scheduled | Reschedule updates `dueDate` (history kept); queued reminders recomputed/cancelled. |
| E34 | Discount ≥ remaining payable / over-paid installment | Capped (`ADJUSTMENT_EXCEEDS_PAYABLE`); refunds are out of scope (BRC-E2). |
| E35 | Discount approved *after* payment was received | Adjustment reduces pending; if it makes `paid > payable−adjusted` it is rejected (would imply refund). |
| E36 | Concession pending approval at admission | Preview shows both "if approved / currently effective"; receivables unchanged until approval. |
| E37 | Optional component (transport) added/removed mid-year | Engine adds a new receivable (or voids unpaid one) via authorised flow; history preserved — BRC-C2. |
| E38 | Late fee accrual job runs twice / during downtime catch-up | Deterministic `periodKey` + unique `dedupeKey`; catch-up posts missed periods only. |
| E39 | Penalty on penalty / on opening balance | Never on penalties; opening balance per BRC-F1. |
| E40 | Opening balance created for a student who already has one | Blocked; reverse + create new. |
| E41 | Opening balance import also contains the same dues as fees | Preview flags `OB + fee for same year`; import never creates fees; totals reconciled before commit. |
| E42 | Fee amounts with paise (₹1,250.50) | Fully supported (integer paise). Currency other than INR not supported (BRC-K1 scope). |
| E43 | Rounding of percentage discounts/penalties | Round-half-up at paise; remainder distributed deterministically; property-tested. |

### Time, concurrency, system
| # | Case | Handling |
|---|---|---|
| E44 | Midnight/UTC boundary around due dates | Business dates in IST; frozen-clock tests at 23:59/00:00 IST and UTC. |
| E45 | Server restart during export/import/promotion | BullMQ retries; idempotent chunks; job status reflects `PARTIAL` truthfully. |
| E46 | Redis down | API reads/writes continue (cache miss, rate-limit falls back to in-memory + alert); enqueue failures are logged and **swept** by scanners; payments never depend on Redis. |
| E47 | Mongo failover mid-transaction | Retry on transient errors; idempotency key makes the retry safe. |
| E48 | Stale tab shows old balance and user pays | Server validates against live pending; UI gets 422/409 with fresh values. |
| E49 | Counter/ID format changed mid-year | New series; old numbers unchanged; uniqueness per series. |
| E50 | Nightly reconcile finds drift | Alert + report; **never auto-fixes money**; correction through an audited admin command. |

### Communication & reporting
| # | Case | Handling |
|---|---|---|
| E51 | Guardian has no/invalid mobile | Reminder `SKIPPED(NO_CONTACT)`, surfaced in audience preview. |
| E52 | Reminder queued, then student pays | SendGuard at send time → `SKIPPED(SETTLED)`. |
| E53 | Provider webhook arrives twice / out of order | Idempotent by `providerMessageId+event`; status only moves forward. |
| E54 | Unapproved WhatsApp/DLT template selected | Blocked at save/send (BRC-H1). |
| E55 | Very large manual audience (whole school) | Preview + confirmation; fan-out chunked; per-channel rate limits. |
| E56 | Report filter yields 0 rows / 500k rows | Friendly empty state / async export with progress. |
| E57 | Export contains `=cmd|…` in a name | Cell sanitised. |
| E58 | Class teacher requests a report outside their division | Scope filter returns only theirs / 403 for catalogue not permitted. |
| E59 | Dashboard numbers differ from report | Single query layer + reconciliation test; any mismatch is a release blocker. |
| E60 | Academic-year switcher on a past year, user tries to edit | Banner "You are viewing 2025-26 (closed)"; edits gated. |

---

## 21. Business Rules Requiring Confirmation

> **BUSINESS RULE REQUIRES CONFIRMATION.** Each item states what is unclear, why it matters, the options, and the **proposed default** the engine will implement *behind a setting* until confirmed. None of these is silently hard-coded.

### A · Institution & structure

**BRC-A1 · Campuses / multiple institutions** — SOW §55.1, §52 (multi-branch is "future"). *Matters:* data model and reporting scope. *Options:* single institution per deployment (**proposed**; `institutionId` present for later) / multi-campus in v1. 
**BRC-A2 · Division capacity** — "Set capacity, if required" (§6). *Options:* informational / **soft warning (proposed)** / hard block.
**BRC-A3 · Class list, streams, promotion path** — Nursery/LKG/UKG? Class 11–12 streams with different fees? *Matters:* class master and fee slots. *Proposed:* class list supplied by client; streams = divisions (or optional `stream` attribute if fees differ per stream).

### B · Students, academics, teachers

**BRC-B1 · ID & number formats** — Student ID, admission number (auto/manual), roll number. *Proposed:* `STU-000001` auto; admission no. client-entered, unique.
**BRC-B2 · Student categories & sibling rules** — List of categories (General, RTE, Staff ward, Sibling…); can category change mid-year; are sibling concessions automatic? *Matters:* fee slot selection and concessions. *Proposed:* categories configurable; change = authorised correction (re-pricing, BRC-C3); sibling = manual concession.
**BRC-B3 · Student exit** — TC/withdrawal/transfer: what happens to future unbilled installments and unpaid dues? *Options:* keep all / void future unpaid installments with approval / pro-rate. *Proposed:* keep past dues; future installments voided only via approved action.
**BRC-B4 · Mid-year admission** — Pro-rating? Installments already past due on admission date: generate as overdue, consolidate into next, or waive. *Proposed:* generate full structure; consolidation optional setting; no pro-rating.
**BRC-B5 · Promotion rules** — Detained/repeat handling, dues-blocking (allow/warn/block), auto-fee assignment for the new year, class-teacher carry-over, roll-number reset. *Proposed:* warn on dues; auto-assign fees on; teachers assigned separately.
**BRC-B6 · Teacher rules** — May a teacher be class teacher of >1 division in a year? Subject teachers needed? Do teachers log in (scope = own division)? Teacher-wise reports attribute to teacher **today** or **as of each date**? *Proposed:* one division per teacher per year (setting); class teacher only; logins optional; attribute as-of **today**.

### C · Fee structure & installments

**BRC-C1 · Structure precedence** — Division-specific and category-specific rules overlap. *Proposed:* most-specific-wins (class+division+category → … → class). Need confirmation that these are the only dimensions.
**BRC-C2 · Optional components** — Is Transport/Activity per-student optional? Route-wise transport amounts? *Matters:* assignment lines and receivables. *Proposed:* optional components toggled per student; single amount per structure (route pricing = future).
**BRC-C3 · Re-pricing existing students** — When 2026-27 fees are edited/republished after assignment, or a student's category changes, do existing students stay on their old version (**proposed**) or get migrated with delta charges/credits? Who approves?
**BRC-C4 · Installment rules** — Remainder paise on first or last installment (**proposed: last**); minimum installment amount; who may customise plans; can due dates be changed per student; maximum number of installments; are *Full payment* discounts (early-bird) a thing?
**BRC-C5 · Year basis** — Academic year (Apr–Mar?) vs financial year for receipt series & reports; month in which the year starts. *Proposed:* academic year drives everything; receipts reset per academic year.

### D · Opening balance & carry-forward

**BRC-D1 · Prior-year dues** — **Model A (aggregate; proposed)** vs **Model B (carry-forward posting)** (§8.3). Also: one opening balance per student per year (**proposed**) or multiple; opening balance **due date** & aging base (**proposed: effective date**); may opening balance be waived/discounted (needs approval) and can it attract late fee? *Matters most: double-counting, aging, reporting.*
**BRC-D2 · Existing payments at admission/migration** — Imported/entered as itemised historical payments (**proposed**) or as a lump "paid to date"? Do they get new receipt numbers or keep the legacy number? Which dues do they settle (engine order vs explicit mapping)?

### E · Payments

**BRC-E1 · Allocation rules** — Default order (**proposed: oldest due first; opening balance → penalty → installment**), alternatives (penalty first, current first), and component split inside an installment (**pro-rata** vs priority list). *Matters:* every outstanding number by fee type.
**BRC-E2 · Advance payments & refunds** — Allowed at all? Auto-apply to next fees? Refund process (cheque/bank), approval, receipt/credit-note handling. *Proposed:* disabled until confirmed; no refunds in v1.
**BRC-E3 · Overpayment** — Reject (**proposed when advance off**) vs convert to advance.
**BRC-E4 · Payment methods & cheque lifecycle** — Method list; is a cheque "paid" on receipt or on clearance (post-dated, bounce, bounce charges)? Reference uniqueness per method? *Proposed:* cheque counts on receipt, reversible on bounce; UPI/bank/card references must be unique.
**BRC-E5 · Back-dating & period lock** — Max back-date days; month-end/day-end closing (cash book lock). *Proposed:* 7 days with permission; no day-closing in v1.
**BRC-E6 · Reversal rules** — Who may reverse; time window; approval (maker-checker) and threshold; refund handling; effect on reports (show reversal on **reversal date** — proposed — vs remove from the original date); retro late-fee recalculation. *Proposed:* approval required above ₹X (set by client), different approver, reversal-date reporting, no retro penalties.

### F · Late fees & discounts

**BRC-F1 · Late-fee policy** — Type (fixed / per-day / % / per-installment), grace days, cap, base (installment pending vs payable), apply to opening balance?, compounding, waivable (by whom), **materialised at posting time (proposed)** vs computed on the fly, exclusion for students on concession. *Matters:* every overdue figure and receipt.
**BRC-F2 · Discount/concession/scholarship** — Definitions of the five types; flat vs %; applied to total or per component; distribution across installments (**proposed: latest-first** for concessions, proportional for scholarships); stacking; multi-year scholarships; approval hierarchy & thresholds; may a collector request; are discounts allowed after payment.

### G · Receipts

**BRC-G1 · Receipt numbering & format** — Prefix, series per year/counter/collector, reset policy, gap-free requirement (**proposed: gap-free per academic-year series**), cancelled-receipt numbering, credit note on reversal?, copy marking, printer type (A4/A5/80 mm thermal), language/script, GST/tax lines (education usually exempt — confirm none), signature/stamp image.

### H · Communication

**BRC-H1 · Channels & providers** — Which are live in v1 (WhatsApp / SMS / Email / in-app)? Vendors? WhatsApp templates require Meta approval; SMS in India requires **DLT** registration; per-message costs are the client's (SOW §25). Consent/opt-out rules; which guardian contact receives messages; quiet hours; language.
**BRC-H2 · Automatic schedule** — Confirm −7, −1, 0, +3, +7 days; repeats after +7 (every N days, max M); excluded students (e.g., pending concession); send time.
**BRC-H3 · "In-app notification"** — Audience is staff users (proposed) or parents (needs a portal; SOW §52 future).
**BRC-H4 · Recovery attribution** — Window after a reminder in which a payment is credited to it (**proposed 7 days**).

### I · Reporting, dashboard

**BRC-I1 · Status vocabulary** — Meaning of **Paid vs Fully Settled** and **Unpaid vs Pending**; **Due Soon window** (days; **proposed 7**); dashboard buckets exclusive (SOW §30 sums to total) vs overlay (**proposed**).
**BRC-I2 · Metric definitions** — Does **Expected Fees** include opening balance (**proposed: separate line; Total Receivable includes it**); **Collection %** denominator (Net Receivable vs due-to-date); aging buckets: **0–30 means 1–30 days overdue** with a separate *Not yet due* (**proposed**); aging as-of date.
**BRC-I3 · Collection targets** — Who sets them; granularity (month/quarter/year/class/division); are targets on *collections* (cash in) or on *dues falling in the period*.
**BRC-I4 · Forecast method** — Choose among schedule-based (**proposed**) / run-rate / client-specified formula.
**BRC-I5 · "Active student"** — For dashboard (§27: active vs inactive/passed-out), reporting by selected year (enrolled in year) and **billing** (BRC-K1).

### J · Security, operations, localisation

**BRC-J1 · Roles & permissions** — Final role list/matrix (§6.3 is a seed); maker-checker thresholds; MFA enforcement; whether Class Teachers log in.
**BRC-J2 · Data retention, backup, hosting** — Statutory retention of financial records; deletion/erasure policy for guardians' PII; RPO/RTO (**proposed 1 h / 4 h**); hosting region (India?), off-site storage provider; DPDP obligations owner.
**BRC-J3 · Migration scope & data quality** — Which entities/years to import; format and quality of existing records (SOW §45: data cleansing is out of scope); who validates reconciliation totals before commit; cut-over date and freeze period.
**BRC-J4 · Language & scripts** — English only (**proposed**) or regional UI/receipts (Hindi/Marathi etc.)? Determines PDF engine (pdfmake vs Chromium), fonts and i18n library.

### K · Commercial / scope

**BRC-K1 · "Active student" for the ₹120/student/year charge** — Enrolled in the current year? Any non-archived? Counted at go-live or yearly snapshot? (Needs a billing-count report either way.) Also confirm: **timeline/scope** vs the 45–60-day estimate (§16.0), and that third-party costs (SMS/WhatsApp/email/storage/Sentry) are client-borne.

---

### How these will be handled in the build
1. Answers are captured in `docs/decisions/` as ADRs and set as defaults in `SystemSetting` seeds.
2. Until answered, the **proposed default** is implemented behind its setting with an **engine test per option**; the UI shows the configured behaviour in plain language.
3. Items that change *stored* shape (D1 Model A/B, F1 materialisation, E6 effective dating) are decided **before Phase 9–11 complete**; everything else can change late with no migration.

**Highest-impact to answer first:** D1 (carry-forward), E1 (allocation order), F1 (late fees), E6 (reversal approval & reporting), G1 (receipt numbering), I1/I2 (status & metric definitions), B6 (teacher rules), K1 (scope/timeline).
