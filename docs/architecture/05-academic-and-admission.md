# 9 · Teacher–Division Architecture · 10 · Student Admission Workflow
(+ enrollment, promotion, academic history, Student 360, academic-year lifecycle)

---

## 9. Teacher–Division Architecture

### 9.1 Model (recap)

```
AcademicYear 1──* Division(class, name) 1──* TeacherAssignment *──1 Teacher
                                             effectiveFrom / effectiveTo / isCurrent / endReason
```
`Teacher` is a master (code, staff ID, contact, qualification, joining date, status). `TeacherAssignment` is the *only* link between a teacher and a division, always **per academic year**, **effective-dated**, **append-only**.

### 9.2 Operations (each is one transaction + audit)

| Operation | Behaviour |
|---|---|
| **Add / Edit Teacher** | `teacherCode` from counter; `staffId` unique; edits audited (before/after). |
| **Activate / Deactivate** | `status` ACTIVE↔INACTIVE (LEFT with `leavingDate`). **Deactivating a teacher who holds a current assignment is blocked** with a clear message (*"Rahul Sharma is class teacher of 6-B (2026-27). Reassign first."*) or offered as "Deactivate and choose replacement" which performs a Change in the same transaction. |
| **Assign** | Division must belong to the year; teacher must be ACTIVE; no current CLASS_TEACHER on that division (else use *Change*); `effectiveFrom` within the year (default: year start or today). **A teacher may hold several divisions in the same year** (setting `teacher.allowMultipleDivisions`, default **true** — decision BRC-B6); when the setting is false a second current assignment for that teacher/year is rejected. Inserts row `isCurrent=true`. |
| **Change teacher** | In one txn: close current row (`effectiveTo = newFrom − 1 day`, `isCurrent=false`, `endReason=CHANGED`), insert new row (`replacesAssignmentId`), reason mandatory. **The old row is never edited otherwise or deleted.** |
| **End assignment** | e.g. teacher left: close, leave division temporarily unassigned (dashboard shows an "Unassigned divisions" alert). |
| **Year roll-over** | `clone-structure` offers "copy last year's class teachers as *proposed* assignments" — they are created as normal rows only after confirmation. A teacher moving 5-A → 6-B is simply a new row in the new year; 2025-26's row stays. |
| **History** | `GET /divisions/:id/assignment-history`, `GET /teachers/:id/assignments` → full timeline across years. |

### 9.3 Guarantees

- DB: partial unique `(divisionId, role) where isCurrent` ⇒ two simultaneous "assign" requests cannot both win.
- Service: `effectiveFrom/To` ranges per `(division, role)` never overlap or leave gaps unless explicitly ended.
- Closed academic year: assignments are read-only (needs `academicYear.override`).
- Every action → `TEACHER_ASSIGNED`, `TEACHER_CHANGED`, `TEACHER_ASSIGNMENT_ENDED` audit entries (entity = assignment; `studentId` null).

### 9.4 Queries the model must answer (and how)

| Question | Query |
|---|---|
| Teacher of Class 5-A in 2026-27 *today* | assignment where `divisionId`, `isCurrent` |
| …as of 15 Aug 2026 | `effectiveFrom ≤ d ≤ (effectiveTo ?? ∞)` |
| Teacher-wise students | assignments `(teacherId, year, current or as-of)` → `divisionIds` → `student_enrollments (divisionId in …, isCurrent)` → students (paged) |
| Teacher-wise class/division | assignments by teacher, joined to class/division lookup maps (cached) |
| Teacher-wise student distribution (dashboard) | count enrollments per division (aggregation) → map division→teacher in the service (≤ ~100 divisions; no `$lookup` needed) |
| Teacher-wise outstanding/collection | aggregate receivables **by division** (indexed) → attribute to the teacher effective on `asOf`: **today for the current year; the academic year's end date for past years; if the teacher changed during the period, show every teacher with their date ranges** (decision BRC-B6, CL-14). |
| Assignment history | by division or by teacher, sorted by `effectiveFrom` |

### 9.5 Class-teacher login & data scope
**Not in release 1** (decision BRC-B6: teachers do not log in). The model keeps `User.teacherId` and the `OWN_DIVISIONS` scope so a later release can add class-teacher logins without schema change. Design when enabled: the scope resolver loads the user's **current** assignments and the repository injects `{ divisionId: {$in: …} }` into student/enrollment/receivable queries.

### 9.6 UI
Teachers list (filters: status, assigned/unassigned, year) · Teacher profile (tabs: Overview · Assignments history timeline · Students (current year) · Audit) · **Assignment board**: grid of Class × Division for the selected year with teacher chips, drag-free (accessible) "Assign / Change" drawer, unassigned divisions highlighted · Division detail shows teacher + history.

### 9.7 Tests
assign; duplicate assign blocked (concurrent); change preserves old row with correct `effectiveTo`; reassign teacher to another class next year keeps previous; deactivate-with-assignment blocked; as-of queries across a mid-year change; teacher-wise students for past year equals roster at that time; scope filter hides other divisions (404).

---

## 10. Student Admission Workflow (Smart Student Addition)

### 10.1 Principle
The wizard is a **guided front-end for one backend command** (`POST /students`) that creates *student + enrollment + fee assignment + receivables (+ opening balance, adjustments, historical payments)* **atomically**. The user never calculates a fee. Step 4 is a live call to `POST /fees/preview`.

### 10.2 Steps (client-side stepper; draft kept in Zustand + `sessionStorage`, restored on refresh)

| Step | Content | Validation (Zod, shared) | Backend interaction |
|---|---|---|---|
| **1 · Basic information** | Name (first/middle/last), DOB, gender, admission number (auto-suggest next / editable per setting), admission date, **student category**, photo (optional), custom fields | required fields; DOB sane range; admission number format | `POST /students/duplicate-check` on blur of admission no / name+DOB → *"A student named Rahul Sharma born 03/05/2015 already exists (STU-000812, Class 4-B)"* — warn, allow override with reason if not same admission no |
| **2 · Parent / guardian** | Primary guardian (name, relation, **mobile**, email), additional guardians, address, fee contact | mobile = valid Indian number (normalized), ≥1 primary | duplicate-by-mobile hint (siblings!) → offers *"Link as sibling"* (BRC-B2: sibling concession) |
| **3 · Academic assignment** | **Academic year** (default current), **class**, **division** (shows seats left / capacity, class teacher), roll no. (optional) | division belongs to class & year; capacity soft/hard (BRC-A2) | loads teacher via assignment; blocks CLOSED year |
| **4 · Fee & opening balance** | Auto-loaded **fee structure + version**, components (optional ones toggleable), **plan** (Full / Installments / Custom†), due dates, **Opening balance** (amount, effective date, reason), **Concession** request(s)†, **Already paid** (historical payments)† | amounts safe ints; † gated by permissions | **debounced `POST /fees/preview`** on every change; renders the **FEE SUMMARY ledger card** (§10.4); shows warnings (e.g. "Installment 1 is already overdue on admission") |
| **5 · Review** | Read-only summary of steps 1–4 with *Edit* links; final preview fetched fresh | — | re-preview; carries `previewHash` |
| **6 · Confirm** | Primary button "Admit student"; shows pending state | idempotency key created when wizard opened | `POST /students` |

† Concessions need `adjustment.create` (may land in *Pending approval* — preview shows both "if approved" and "currently effective"); historical payments need `payment.backdate`; custom installments need `feeAssignment.manage`; opening balance needs `openingBalance.create` — otherwise the control is hidden, not just disabled.

### 10.3 What the backend does (one transaction)

```
validate (Zod) · authorize · idempotency
1  duplicate checks: admissionNo (unique), duplicate-student heuristic (409 unless acknowledged)
2  Student insert (studentId from counter)
3  StudentEnrollment insert (type NEW_ADMISSION|MIGRATION, isCurrent) ; student.current projection set
4  resolve fee structure (7.4) ; compare previewHash → 409 PREVIEW_STALE if different
5  FeeAssignment insert (snapshot lines) ; Receivables generated (installments) with dedupe keys
6  OpeningBalance insert + its Receivable (if provided)
7  Adjustments: create (APPROVED if allowed/auto, else PENDING_APPROVAL) and apply to receivables
8  Historical payments: Payment(source=HISTORICAL) + allocations via engine (+ receipt policy BRC-D2)
9  StudentYearBalance recompute
10 AuditLog: STUDENT_CREATED, ENROLLMENT_CREATED, FEE_ASSIGNED, OPENING_BALANCE_CREATED, ADJUSTMENT_REQUESTED, PAYMENT_CREATED(historical)
commit → afterCommit: cache bump · (optional) welcome/fee notification
response { student, enrollment, feeSummary, nextActions: ["collect-payment","print-admission-summary","add-another"] }
```
Any failure rolls back everything — there is no half-created student.

### 10.4 The "FEE SUMMARY" ledger card (signature component)
Shows exactly the SOW/brief layout: Applicable Fee · Opening Balance · Concession · Already Paid → **CURRENT OUTSTANDING** (double-rule total), then Next Installment + Due Date, an expandable installment schedule (date, payable, paid, pending, status chip) and a "How this was calculated" disclosure listing structure/version used. Numbers come only from the preview API; the card shows a skeleton while recalculating and an inline error with retry if the preview fails — Confirm stays disabled until a fresh, valid preview exists.

### 10.5 Admission edge handling
No fee structure for slot → Step 4 blocks with explanation + link for authorized users · category changed after Step 4 → preview invalidated and re-run · structure republished while the wizard is open → `PREVIEW_STALE` at confirm shows a diff and asks to re-confirm · division full (hard capacity) → blocked, soft → warning · closed/planned year → blocked/allowed per status · browser refresh → draft restored · double click → idempotent · admission number collision race → 409 with next suggestion.

### 10.6 Existing student, new year (not a new student)
`POST /enrollments` (or promotion) for returning/readmitted students re-uses the same fee-preview/assignment path — **Enroll existing student** wizard = steps 3–6 only.

---

## 10A. Enrollment, Promotion & Academic History

### 10A.1 Enrollment rules
- One current enrollment per student-year (DB-enforced). **Division change within a class/year** = close row (`endReason=DIVISION_CHANGE`) + new row; fee assignment persists (same class), receivables' reporting dimensions (`divisionId`) are updated in the same txn — amounts untouched. **Class change within a year** is a financial event (different fee structure) → only via authorized *correction* flow that reassigns fees (BRC-C3/B3); default: blocked.
- `student.current` is a projection updated in the same txn; `rebuild-student-current` admin job recreates it from enrollments.

### 10A.2 Promotion (bulk, previewed, chunked, idempotent)
1. **Draft:** choose from-year → to-year, scope (class/divisions). Default mapping: next class by `sequence`, same division name if it exists in the target year else *unmapped* (user picks). `isFinal` class ⇒ default action **PASS_OUT**.
2. **Per-student decision grid:** PROMOTE · REPEAT (same class next year) · PASS_OUT · HOLD (skip). Warnings per row: outstanding dues (*policy allow/warn/block — BRC-B5*), already enrolled in target year, target division over capacity, no fee structure for target slot.
3. **Preview:** counts, per-division distribution, fee structures to be assigned, warnings.
4. **Commit** (`Idempotency-Key`, BullMQ chunks of 100; each student in **its own transaction**): end old enrollment (`PROMOTED`/`REPEATED`/`PASSED_OUT`, `endedOn`), create new enrollment (`type=PROMOTION|REPEAT`, `previousEnrollmentId`, `promotionBatchId`), update `student.current` / status (PASSED_OUT), optionally create fee assignment + receivables for the new year (setting `autoAssignFeesOnPromotion`), audit `STUDENT_PROMOTED`. Re-running a partially failed batch only processes students not yet enrolled in the target year (unique index guarantees safety).
5. **Undo:** a promotion can be *cancelled per student* only while the new enrollment has **no financial activity**; otherwise blocked. Previous enrollments are never modified beyond their closing fields.

### 10A.3 Academic history
`GET /students/:id/academic-history` → timeline `Class 1-A (2019-20) → 2-B → 3-A …` each with year, class, division, class teacher *as of that year*, enrollment type/outcome, fee outcome (billed, paid, pending, **per-year**). Nothing in a past row is ever rewritten; corrections (e.g., wrong division recorded) use `endReason=CORRECTION` + a new row with reason, so the original remains visible.

### 10A.4 Academic-year lifecycle
`PLANNED` (structure being built, fees drafted) → `ACTIVE` (can be `isCurrent`; exactly one current) → `CLOSED` (locked; postings need `academicYear.override`; closing runs checks: unassigned divisions, pending adjustments/reversals, reconcile job green). Future and past years remain fully queryable (SOW §4). Year-wise fee structures are created by *clone from previous year → edit → publish*.

---

## 10B. Student 360 (data composition & UX)

**Header (always visible, sticky on scroll):** photo/initials, name, Student ID, admission no., class-division · year, class teacher, status chip, **Outstanding** (with overdue chip), actions: **Collect payment · Send reminder · Edit · More (Promote, Change division, Deactivate)** — each action permission-gated.

| Tab | Contents (progressive disclosure) | API |
|---|---|---|
| **Overview** | Key facts, parent/guardian cards, *current* academic info (year, class, division, class teacher), fee snapshot (gross, opening, discounts, paid, outstanding, overdue, next due), recent activity | `GET /students/:id/360` (single composed call, cacheable) |
| **Academic** | **Timeline** of enrollments (year → class-division → teacher → outcome), expandable per-year fee outcome | `/academic-history` |
| **Fees** | **Year selector** (default current). Cards: Fee Summary (ledger card), **Opening Balance** (own card, source/reason/by/when), Fee Structure (version used, components), **Installments table** (due, payable, adjusted, paid, pending, status chips, aging), Discounts & Concessions (type, amount, reason, approved by, status) | `/fees?academicYearId` |
| **Payments** | Payments table + receipt links (number, date, amount, method, reference, collector, status incl. REVERSED with reason), receipt preview drawer, reversal action (if permitted) | `/payments`, `/receipts` |
| **Communication** | Reminder history (channel, type, message snapshot, sent by/system, delivery/failure status), "Send reminder" composer | `/reminders?studentId` |
| **Activity** | Audit timeline filtered to this student (created, updated, promoted, fee assigned, OB, payments, reversals, reminders) | `/audit-logs?studentId` |

Lazy-load tab data on first open; keep header data cached; `QueryBoundary` provides loading/empty/error states per tab. **Mobile:** header collapses to a compact card; tabs become a scrollable segmented control; Fees tab shows installments as stacked cards with status chips; **Collect payment** is a sticky bottom action.
