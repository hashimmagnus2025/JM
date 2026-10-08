# 12 · Reminder Architecture · 13 · Dashboard Architecture
(+ reports & exports, import/migration, global search)

---

## 12. Reminder Architecture

### 12.1 Goals (SOW §21–§26)
Manual + automated reminders · targeting (student(s), class, division, unpaid, partial, overdue, specific installment) · channels (WhatsApp, SMS, Email, In-app) · configurable schedule · templates with variables · **stop automatically when the balance is cleared** · complete, traceable history.

### 12.2 Components

```
UI (composer / rules / queue / history)
   │
Reminder API ── AudienceResolver  (same FinanceFilter vocabulary → students + receivables, scope-aware)
   │                │
   │                └─► Campaign (snapshot of filter) ──► fan-out job
   ▼
BullMQ queues:  reminder.scan (scheduled)  ·  reminder.fanout  ·  reminder.send:{whatsapp|sms|email|inapp}  ·  reminder.dlr
   │
Worker: TemplateRenderer → SendGuard → ChannelProvider (port) ──► WhatsApp / SMS / Email adapter | InApp(notifications)
                                              ▲
Webhook /webhooks/:provider (HMAC) ──► delivery status (DELIVERED / READ / FAILED) ──► reminders.status
```

### 12.3 Manual reminders
1. User picks a **target** (individual student, multi-select, class, division, status filter: unpaid/partial/overdue, specific installment) — via the Outstanding table (bulk action) or the Reminders composer.
2. **Audience preview** (`POST /reminders/audience-preview`): *N students · M contacts · ₹ total pending · K without a valid contact · J with a reminder already sent in the last X days* — duplicates suppressed (warn).
3. Choose channel(s) + template (live preview rendered with a real sample student) + send **now** or **scheduled**.
4. Creates `ReminderCampaign` → `fanout` job creates one `Reminder` per (student × channel) with `dedupeKey` → `send` jobs.

### 12.4 Automated reminders
- `ReminderRule`: offset (SOW §22 defaults: **−7, −1, 0, +3, +7 days**), type (Upcoming / Due-today / Overdue / Follow-up), `sendTime` (IST), channels, template per channel, target filter, optional repeat (`repeatEveryDays`, `maxRepeats`), active flag. (**BRC-H2** confirms defaults.)
- **`reminder.scan`** (hourly repeatable job; sends only when `sendTime` window arrived): for each active rule compute `targetDueDate = today − offsetDays` → find receivables `pending>0 AND dueDate = targetDueDate` (indexed partial `(institutionId,dueDate) where pending>0`) → group by student → enqueue fan-out with job id = `dedupeKey`.
- **`dedupeKey = ruleId:receivableId:offsetDays:repeatIndex:channel`** — enforced twice: BullMQ job-id dedupe **and** unique index on `reminders` ⇒ at-most-once per rule/receivable/offset even if the scanner runs twice.
- **Scheduled queue view** (SOW §23): upcoming `QUEUED` reminders, filterable, cancellable.

### 12.5 "Stop when cleared" — defence in depth
1. **SendGuard at send time** (authoritative): re-reads the live receivables for `reminder.receivableIds`; if all `pending = 0` (or `VOID/WAIVED`) → status `SKIPPED(SETTLED)`, nothing sent. Also skips for: guardian opted out, no valid contact, outside quiet hours (rescheduled to window), student not ACTIVE.
2. **Post-payment hook:** after a payment commit, `QUEUED` reminders referencing fully-paid receivables are marked `CANCELLED` (best-effort, optimisation only).
3. **Message amount** in the text is computed at send time (`pendingAtSend`), so a partial payment between scheduling and sending doesn't produce a stale amount.

### 12.6 Templates
Variables (SOW §24): `{{studentName}} {{parentName}} {{class}} {{division}} {{academicYear}} {{pendingAmount}} {{installment}} {{dueDate}} {{institutionName}}` (+ `{{receiptNo}}`, `{{paymentLink}}` later). Allow-listed variable set; Zod-checked at save; rendering is a pure function with escaping and ₹/date formatting (`₹10,000`, `10 Oct 2026`). Per-channel constraints surfaced in the editor (SMS length/segments; **WhatsApp templates must be pre-approved by the provider and are sent by provider template ID + parameters; SMS in India requires DLT-registered templates** → `providerTemplateId`, `approvalStatus` stored; sending with an unapproved template is blocked — **BRC-H1**).

### 12.7 Provider adapters (SOW §25: third-party, charged separately)
`ChannelProvider { send(msg): Promise<{providerMessageId}>; parseWebhook(req) }` implemented per vendor behind env config; **`ConsoleProvider`** (dev/test) and **`InAppProvider`** (writes `notifications`) ship first. Queues are per-channel with rate limiting (provider limits), retries with exponential backoff (e.g., 5 attempts), permanent failures classified (invalid number vs transient) and recorded as `FAILED` with `failureReason`. Provider credentials in env/secret store; never logged.

### 12.8 History & recovery analytics
`Reminder` rows persist student, guardian snapshot, type, **rendered message snapshot**, channel, timestamps, `sentBy` (user or `SYSTEM`), delivery/failure status → SOW §26. **Recovery after reminders** (SOW §51): amount allocated to the same receivables within a configurable window after `sentAt` (proposed 7 days, **BRC-H4**) — computed from `payment_allocations ⨝ reminders` per receivable; reported per campaign/rule/channel.

### 12.9 UI
Composer (audience → message → schedule → review) · Rules (list + editor with human-readable summary "7 days before due date, 10:00, WhatsApp + SMS") · Queue (upcoming; cancel) · History (filters; delivery chips; per-student drill) · Templates (editor with variable chips + live preview + approval status). **Never** shows a "Send" without an audience count and cost-neutral confirmation.

---

## 13. Dashboard Architecture

### 13.1 Principles
1. **One filter object** (`FinanceFilter`: year, class, division, teacher, category, date range, …) drives every widget **and** the drill-down URL ⇒ numbers always match the list you land on.
2. **One query service** (`FinanceQueryService`) implements the §7.2 metric dictionary; dashboard, reports and exports call it — never ad-hoc aggregations in controllers.
3. **Server-side aggregation only.** The browser never receives thousands of student rows for a chart.
4. **Scope-aware:** class teachers see their divisions; collectors see their own collections.

### 13.2 Widgets → data source

| Widget (SOW §27–§35 + brief) | Source | Cache |
|---|---|---|
| KPI strip: Students, Classes, Divisions, Teachers, **Expected Fees (opening balance excluded)**, Collected, Outstanding, Overdue, **Collection % = Collected ÷ Expected** (definitions: [11 §11.3](11-business-rule-decisions.md)); opening balance shown as its own tile | `student_year_balances` ⨝ enrollments (counts) + receivables (overdue) | 60 s, version-keyed |
| Today / Month / Year collection, Upcoming due, Overdue amount | `payment_allocations` by `postingDate` · receivables due window | 30–60 s |
| **Collection trend** (day/week/month) | allocations grouped by `postingDate` | 5 min |
| **Expected vs Actual** (by month / by class) | receivables `payable−adjusted` by due month vs allocations | 5 min |
| **Outstanding trend** | `daily_snapshots` | daily |
| **Class / Division performance** | receivables grouped by `classId`/`divisionId` → Collection %, outstanding; sortable; worst-first highlight | 2 min |
| **Teacher-wise student distribution** | enrollments per division → teacher map (§9.4) | 5 min |
| **Payment status** (Paid / Partial / Unpaid / Overdue / Due soon) | `student_year_balances` (+ `earliestPendingDueDate < today`) | 60 s |
| **Aging** | receivables `pending>0` bucketed by `today − dueDate` (+ Not due) | 2 min |
| **Collection target** (monthly/quarterly/year/class/division) | `collection_targets` vs allocations | 2 min |
| **Forecast** (SOW §35) | see 13.4 | daily |
| **Recovery performance** | allocations after reminders (12.8) · recovered vs overdue | 10 min |
| Alerts | unassigned divisions · pending approvals (adjustments/reversals) · failed reminders · reconcile drift | live |

### 13.3 Performance mechanics
- **Cache keys include a `financeVersion` counter** (Redis `INCR` after any financial commit) ⇒ stale data is *impossible* beyond the in-flight request; TTLs are only a memory bound.
- Aggregations hit compound indexes (`receivables (institutionId, academicYearId, classId, divisionId, paymentStatus)`; `student_year_balances`); `explain()` tests guard against COLLSCAN regressions.
- Heavy trend data is **pre-aggregated** nightly (`daily_snapshots`) rather than recomputed from history on each view.
- Skeleton states per card; each widget is an independent query (a failing widget shows its own retry, never blanks the page); `staleTime` aligned with server TTL.

### 13.4 Collection forecast — transparent, not magic (**BRC-I4**)
SOW says only "system-calculated estimate". Proposed *explainable* method, selectable by the client:
1. **Schedule-based (default):** projected = collected-to-date + Σ over remaining months of (pending due in month × historical on-time recovery rate for that month-offset, from last year's snapshots; fallback = current-year rate to date).
2. **Run-rate:** collected-to-date ÷ elapsed fee-days × remaining fee-days (capped by outstanding).
UI always shows the method, inputs and a range (low/likely/high) — never a single unexplained number.

### 13.5 Drill-down
`Class → Division → Teacher → Student → Fee → Installment → Payment` implemented as **URL-state navigation** (`/dashboard?classId=…` → `/outstanding?groupBy=division&classId=…` → `/students?divisionId=…&feeStatus=overdue` → Student 360 › Fees › installment drawer › payment/receipt). Breadcrumb trail reflects the path; back button works; every KPI tile and chart segment is a link.

### 13.6 Layout (desktop first)
Row 1: academic-year context + filter chips · Row 2: KPI strip (9 tiles, compact ₹ Lakh/Cr formatting, sparkline, delta vs last period) · Row 3: Collection trend (wide) + Payment status donut (clickable) · Row 4: Expected vs Actual + Class performance (sortable bar/table toggle) · Row 5: Division performance (selected class) + Teacher distribution · Row 6: Aging (stacked bar with ₹ and counts) + Target progress + Forecast · Row 7: Alerts & recent activity. Mobile: KPI carousel → Today's collection → Payment status → Top overdue classes.

---

## 13A. Reports & Exports

### 13A.1 Report registry (one definition → JSON table, CSV, XLSX, PDF)
```
ReportDefinition { key, title, permission, filterSchema (Zod), columns[{key,label,type: money|date|text|percent|count,align,total?}],
                   query(filters, principal) → cursor/aggregation, totals(filters), defaultSort, groupings?, pdfLayout }
```
Catalog (SOW §36 + brief): Student-wise Fee · Class-wise Fee · Division-wise Fee · Teacher-wise Students · Academic-Year · Date-wise Collection · Installment · Outstanding · Overdue · Aging · Payment Method · Reminder · Collection Staff · Discount/Concession · **Opening Balance** · Receipt register · Reversal register · Fee-structure change log. Filters (all optional, combinable): academic year, class, division, teacher, student, status, date range, amount range, payment method, collector, fee type, category.

### 13A.2 Export pipeline
- **Interactive table:** server-paginated JSON with totals row.
- **Export ≤ ~5,000 rows (CSV/XLSX):** streamed straight from a Mongo cursor (ExcelJS streaming writer / csv-stringify) — constant memory.
- **Larger exports and all PDFs:** `POST …/export` → `202` + `ExportJob` → BullMQ `report.export` → file in S3 (`exports/…`, lifecycle 7 days) → in-app notification → `GET /exports/:id/download` returns a **short-lived presigned URL**. Exports respect the exact filters, the user's **data scope**, and `student.viewContact` for PII columns; every export is audited (who, filters, rows).
- **CSV/Excel injection defence:** cells beginning `= + - @ \t \r` are prefixed with `'`.
- **PDF:** pdfmake, embedded Noto Sans (₹), repeat header per page, filter summary + generated-by/at footer, landscape for wide tables.

---

## 13B. Import / Migration (SOW §45)

```
UPLOAD ──► STAGE (parse to import_rows) ──► VALIDATE (async) ──► PREVIEW ──► CONFIRM ──► COMMIT (chunked) ──► REPORT
```
1. **Templates:** downloadable XLSX per type with headers, sample row, dropdown validations, instructions sheet (Students, Enrollments, Classes, Divisions, Teacher assignments, Opening balances, Fees/assignments, Payments).
2. **Upload:** type, file (CSV/XLSX; size/row caps; MIME + magic-byte sniff; stored in S3; sha256 checksum; **same file twice → warning**). Column mapping step for non-template headers.
3. **Validate (BullMQ):** per-row Zod + referential checks (class/division/year exist, student exists/duplicate admission no, teacher by staff ID, amounts positive integers/decimals→paise, dates parse as `BusinessDate`, **duplicate within file**, duplicate against DB, **duplicate payment** by unique reference, **OB already exists**). Each row: `VALID | INVALID | DUPLICATE | WARNING` + coded errors.
4. **Preview screen:** **Total · Valid · Invalid · Duplicate · Missing · Errors** counts, row grid with filter by status, "Download errors (CSV)", sample of what will be created, **financial reconciliation** (e.g., *"Opening balances: 1,204 rows, ₹48,32,500 total; Gross fee unchanged"*).
5. **Confirm:** explicit checkbox + typed confirmation for financial types (`import.commit`; optional second approver). Options: *commit only if zero invalid* (default for finance) or *skip invalid rows* (explicit).
6. **Commit:** chunked (e.g., 200 rows/txn); idempotent per row (`importRef {batchId,rowNo}` unique on created entities ⇒ re-running never duplicates); progress via polling; final report (created/skipped/failed) downloadable; every created entity carries `source=IMPORT` and batch id; one audit entry per batch + per-entity audit.
7. **Order guidance in UI:** Classes → Divisions → Teachers → Assignments → Students+Enrollments → Opening balances → Fee assignments → Historical payments.
8. **No silent partial financial state:** a failed chunk leaves earlier chunks committed but the batch is `PARTIAL` with an exact list; *Resume* processes only uncommitted rows.

---

## 13C. Global search

`GET /search?q=` — one box (Cmd/Ctrl+K and header field): **student name, admission no., student ID, mobile, parent name, receipt number.**
- Normalization: lowercase, diacritics stripped, whitespace collapsed; mobile → last 10 digits.
- Strategy: classify the query (digits → mobile/ID/receipt; text → name tokens); run **anchored prefix** lookups on indexed fields (`searchTokens`, `mobileSearch`, exact `studentId/admissionNo/receiptNo`), merge & rank (exact ID > prefix > token-prefix), **limit 8 per group**, scope-filtered. Regex input is escaped; max length; min 2 chars; 250 ms debounce; in-flight cancelled.
- Result rows: avatar, name, class-division · year, admission no., outstanding chip; Enter → Student 360, `Ctrl+Enter` → Collect payment; receipt hit → receipt drawer. Recent searches kept locally.
- Upgrade path (if >100k students or fuzzy matching is required): Atlas Search / OpenSearch behind the same endpoint.
