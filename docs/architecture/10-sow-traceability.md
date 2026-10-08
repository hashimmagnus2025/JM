# SOW → Design Traceability

Every SOW section (§1–§56) and the three client additions map to a design element and a delivery phase. "Phase" refers to [08-delivery.md](08-delivery.md) §16.

| SOW § | Requirement | Design coverage | Phase |
|---|---|---|---|
| 1 | Lifecycle, student-level + institution-level visibility, Class 1→12 history | Enrollment history (§10A), Student 360 (§10B), dashboard drill-down (§13.5) | 6–7, 15 |
| 2 | 15 objectives | Whole design; reconciled in §7.2 metrics | all |
| 3 | Institution info; Year→Class→Division→Students; configurable | `Institution`, `AcademicYear`, `Class`, year-scoped `Division` (§3.3 A/B) | 3–4 |
| 4 | Create/activate/define current/previous/future years; assign students; year-wise fee structures; historical records unchanged unless authorised correction | Year lifecycle (§10A.4), `isCurrent` unique, `CLOSED` lock + `academicYear.override` | 3 |
| 5 | Class add/edit/sequence/activate; fee structure assignment; per-class counts & collection/outstanding/expected | `Class.sequence/isActive`, `/classes/:id/summary`, FinanceQueryService | 4, 13 |
| 6 | Divisions create/edit/assign/capacity; division-wise fees/collection/outstanding | Division model, capacity (BRC-A2), division summaries | 4, 13 |
| 7 | Student master fields incl. current year/class/division, category, status, "other configurable info" | `Student` + `current` projection + `customFields` (§3.3 D) | 6 |
| 8 | Promotion creates new year/class/division record, never overwrites | `PromotionBatch`, append-only enrollments (§10A.2) | 7 |
| 9 | Student 360° (13 sections) | Tabs Overview/Academic/Fees/Payments/Communication/Activity (§10B) | 6, 9–13 |
| 10 | Fee components; configure by year/class/division/category/fee type | `FeeComponent`, `FeeStructure` slot (§3.3 E), precedence (§7.4) | 8 |
| 11 | Fee structure versioning; 2026-27 change must not alter 2025-26 | Immutable `FeeStructureVersion`, assignment snapshots, regression test (I14) | 8 |
| 12 | Full/installment/partial/custom/multiple/due dates/installment-specific components | Plans in version, `CUSTOM` plan, `componentSchedule`, receivable `components[]` (§7.5) | 8–10 |
| 13 | Fee collection workflow | §11.1 workflow, Collect screen (§14.5) | 11 |
| 14 | Payment methods + reference numbers | Configurable methods, reference rules (BRC-E4) | 11 |
| 15 | Partial payment; remainder in outstanding | §7.8 examples, `PARTIAL` status | 11 |
| 16 | Advance payment (if permitted) | `advance.enabled`, `unallocatedAmount` credit (BRC-E2) | 11 |
| 17 | Automatic allocation + controlled manual | Allocation engine strategies (§7.8), `payment.allocateManual` | 11 |
| 18 | Fee status: Paid/Partial/Unpaid/Due Soon/Overdue/Fully Settled | Two-dimension status model (§7.9), BRC-I1 | 10, 13 |
| 19 | Outstanding formula; visible student/class/division/year/fee-type/installment | §7.10, `/outstanding?groupBy=` incl. teacher | 13 |
| 20 | Overdue & aging buckets | §7.2 aging, `/outstanding/aging`, `daily_snapshots` | 13, 15 |
| 21 | Reminder engine; manual targets (8 kinds) | §12.3 audience resolver | 14 |
| 22 | Automated reminders (−7, −1, 0, +3, +7); stop when cleared | §12.4–12.5 (SendGuard) | 14 |
| 23 | Date/time/frequency/type/targets/channel config; scheduled queue | `ReminderRule`, queue view | 14 |
| 24 | Templates with variables | §12.6 | 14 |
| 25 | WhatsApp/SMS/Email/In-app (third-party) | Provider ports/adapters (§12.7), BRC-H1/H3 | 14 |
| 26 | Reminder history fields | `Reminder` snapshot (§3.3 I) | 14 |
| 27 | Institution dashboard academic overview | KPI strip (§13.2) incl. active/inactive/passed-out (BRC-I5) | 15 |
| 28 | Class & division overview + drill-down | Class performance + URL-state drill-down (§13.5) | 15 |
| 29 | Fee collection overview (today/month/year/upcoming/overdue) | §13.2 | 15 |
| 30 | Student payment status counts + click-through | Payment-status widget (BRC-I1) | 15 |
| 31 | Expected vs actual | Widget + metric dictionary | 15 |
| 32 | Class performance | Widget | 15 |
| 33 | Division performance | Widget | 15 |
| 34 | Collection targets (monthly/quarterly/year/class/division) | `CollectionTarget` (BRC-I3) | 15 |
| 35 | Collection forecast | §13.4 (BRC-I4) | 15 |
| 36 | 12 advanced reports | Report registry (§13A) — 17 reports incl. additions | 16 |
| 37 | Student & fee filters; combinable | `FinanceFilter` vocabulary, URL-synced FilterBar | 6, 13, 16 |
| 38 | Global search incl. receipt number | §13C | 6 |
| 39 | Scholarship/discount/concession/waiver/other; type, amount, reason, approver, date, remarks; original fee traceable | `Adjustment` (§3.3 F), approval flow, §7.6 | 9 |
| 40 | Late fee/penalty (fixed, daily, %, installment-specific) | `LateFeePolicy`, §7.7 (BRC-F1) | 10 |
| 41 | Receipt contents; printable/downloadable | `Receipt` snapshot + PDF (§11.5) | 12 |
| 42 | Cancel/reverse with reason, user, time, original transaction, audit | §11.4, `PaymentReversal`, append-only ledger | 11 |
| 43 | Duplicate & error prevention (8 kinds) | Unique indexes, idempotency, guarded updates, engine validation (§3.4 I1–I14, §11.2) | 9–11 |
| 44 | Audit trail | `AuditLog` in-transaction + hash chain (§18.4) | 2, 18 |
| 45 | Excel/CSV import; validation set | §13B two-phase importer | 17 |
| 46 | Export Excel/CSV/PDF respecting filters | §13A.2 | 16 |
| 47 | Users, roles, module permissions, financial/report/reminder restrictions | §6 RBAC | 2 |
| 48 | Secure auth, RBAC, financial restrictions, secure DB, audit, backup, controlled modifications, session controls | §18 (auth §6.5, backup §18.8, sessions §18.9) | 2, 18, 20 |
| 49 | 24 recommended modules | §15.2 module list (1:1 + search/imports/exports/files) | all |
| 50 | End-to-end process | Phase ordering (§16.1) and the lifecycle in README §0.1 | all |
| 51 | Management questions (academic/financial/recovery/performance) | Each answerable from dashboard/report registry; recovery-after-reminders §12.8 | 13–16 |
| 52 | Future expansion (portals, gateway, multi-branch…) | `institutionId` everywhere, provider ports, no coupling to UI roles; **not built** | — |
| 53–54 | Optional integrations / out of scope | Adapters only; costs client-borne (BRC-K1) | — |
| 55 | 40 confirmation points | Answered by design or listed in §21 (BRC) | pre-1 |
| 56 | Final vision, visibility at every level | Institution→Class→Division→Student→Installment→Payment drill-down | 15 |
| p.28 | Commercial summary (₹50k, 45–60 d, VPS ₹6k/mo, ₹120/student/yr) | Deployment §1.6, scope risk §16.0, BRC-K1 | — |
| §21 | Open business rules | Final client decisions for D1, E1, F1, E6, G1, I1/I2, B6, K1 → [11-business-rule-decisions.md](11-business-rule-decisions.md) | 1 |

## Client additions

| Addition | Where |
|---|---|
| **#1 Teacher management** (Teacher + TeacherAssignment, history, teacher-wise students/class-division/year) | §3.3 C, §9, API §5.3, Phase 5 |
| **#2 Smart student addition** (auto fee determination, financial preview, backend source of truth) | §10, `POST /fees/preview` (§5.4), §7.11 |
| **#3 Opening balance** (record, no duplicate fee, visible in 360/summary/history/reports/audit) | §3.3 F, §8, Phase 9 |
| **Financial integrity** (duplicate prevention, cancel/reverse not delete) | §3.4, §11, §18.6 |
| **Historical integrity** (students, teachers, divisions, fees, installments, payments, receipts, discounts, reminders, opening balances never overwritten) | §3.4 mutability matrix, I1–I14 |
