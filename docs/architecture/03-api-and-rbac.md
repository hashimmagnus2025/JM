# 5 · API Architecture  &  6 · RBAC Matrix

## 5. API Architecture

### 5.1 Conventions (uniform across every endpoint)

| Topic | Rule |
|---|---|
| Base | `/api/v1`, JSON, UTF-8. OpenAPI 3.1 generated from Zod; Swagger UI at `/api/docs` (non-prod / admin-only). |
| Auth | `Authorization: Bearer <access JWT>`. Refresh token is an **httpOnly, Secure, SameSite=Strict cookie scoped to `/api/v1/auth`**. |
| Success envelope | `{ "data": <T>, "meta"?: {…} }` |
| List envelope | `{ "data": T[], "meta": { "page", "pageSize", "total", "totalPages", "sort", "filtersApplied" } }` — offset pagination for tables (jump-to-page, totals). **Cursor pagination** (`?cursor=&limit=`) for append-only streams (audit logs, reminder history, payment allocations) and exports. |
| Pagination | `page` (1-based), `pageSize` (default 25, max 100). |
| Sorting | `sort=-paymentDate,fullName` (allow-listed fields per endpoint). |
| Search | `q=` (normalized, min 2 chars). |
| Filtering | Flat, typed query params validated by Zod (`academicYearId`, `classId`, `divisionId`, `teacherId`, `status`, `feeStatus`, `from`, `to`, `minAmount`, `maxAmount`, `method`…). Multi-value: `classId=a&classId=b`. The **same `FinanceFilter` vocabulary** is used by outstanding, dashboard, reports and exports. |
| Money in JSON | Integer paise in `…Paise`-less fields documented as paise; display formatting is a frontend concern. (`"amount": 1500000` = ₹15,000.00). |
| Dates in JSON | Business dates `"2026-10-10"`; timestamps ISO-8601 UTC. |
| Concurrency | Mutable masters: `ETag`/`If-Match` (`version`) → `409 VERSION_CONFLICT`. |
| Idempotency | `Idempotency-Key` required on: `POST /payments`, `/payments/:id/reverse`, `/students`, `/promotions/*/commit`, `/imports/*/commit`, `/opening-balances`, `/adjustments/*/approve`. Replay → original response. |
| Request id | `X-Request-Id` accepted/generated, returned, logged, attached to Sentry + audit. |
| Rate limits | Global per-IP; stricter on `/auth/*`; per-user on exports/search. `429` + `Retry-After`. |

### 5.2 Status codes & error body

| Code | Use |
|---|---|
| 200 / 201 / 202 / 204 | OK / created / accepted (async job) / no content |
| 400 | Malformed request or Zod validation failure |
| 401 | Missing/expired/invalid token (`TOKEN_EXPIRED` lets the client refresh once) |
| 403 | Authenticated but lacks permission or data scope (`FORBIDDEN`) |
| 404 | Not found **or not visible in scope** (never leaks existence) |
| 409 | Conflict: duplicate (`DUPLICATE_ADMISSION_NO`, `DUPLICATE_TRANSACTION_REF`), version conflict, state conflict |
| 422 | **Business-rule violation** with stable code (`PAYMENT_EXCEEDS_OUTSTANDING`, `ACADEMIC_YEAR_CLOSED`, `RECEIVABLE_NOT_PAYABLE`, `PREVIEW_STALE`…) |
| 429 / 5xx | Rate limited / server error (generic message + `requestId`) |

```json
{ "error": { "code": "PAYMENT_EXCEEDS_OUTSTANDING",
             "message": "Payment of ₹25,000 is more than the outstanding ₹20,000.",
             "details": [{ "field": "amount", "issue": "max", "max": 2000000 }],
             "requestId": "01J…" } }
```
Frontend maps `code → human message`; `message` is a safe fallback, **never** a stack trace or DB error.

### 5.3 Endpoint catalogue (`/api/v1`)

Permission keys are defined in §6.2. "scope" = data-scope applies (class teachers see only their divisions).

| Module | Endpoints | Permission |
|---|---|---|
| **auth** | `POST /auth/login` · `/auth/refresh` · `/auth/logout` · `/auth/logout-all` · `GET /auth/me` · `POST /auth/change-password` · `/auth/forgot-password` · `/auth/reset-password` · `GET/DELETE /auth/sessions[/:id]` | public / authenticated |
| **users** | `GET/POST /users` · `GET/PATCH /users/:id` · `POST /users/:id/activate|deactivate|reset-password|unlock` | `user.view` / `user.manage` |
| **roles / permissions** | `GET/POST /roles` · `GET/PATCH /roles/:id` · `POST /roles/:id/archive` · `GET /permissions` (catalog, read-only) | `role.view` / `role.manage` |
| **institution / settings** | `GET/PATCH /institution` · `POST /institution/logo` · `GET /settings` · `PATCH /settings/:key` | `institution.view|manage`, `settings.view|manage` |
| **academic-years** | `GET/POST /academic-years` · `GET/PATCH /:id` · `POST /:id/set-current` · `/:id/close` · `/:id/reopen` · `/:id/clone-structure` | `academicYear.view|manage|close` |
| **classes** | `GET/POST /classes` · `GET/PATCH /classes/:id` · `GET /classes/:id/summary?academicYearId` (divisions, students, expected, collected, outstanding) · `POST /classes/reorder` | `class.view|manage` |
| **divisions** | `GET/POST /divisions` (`academicYearId`, `classId`) · `GET/PATCH /divisions/:id` · `GET /divisions/:id/summary` · `GET /divisions/:id/assignment-history` | `division.view|manage` |
| **teachers** | `GET/POST /teachers` · `GET/PATCH /teachers/:id` · `POST /teachers/:id/activate|deactivate` · `GET /teachers/:id/assignments` · `GET /teachers/:id/students?academicYearId` · `GET /teachers/:id/divisions?academicYearId` | `teacher.view|create|update|deactivate` |
| **teacher-assignments** | `GET /teacher-assignments` (`academicYearId`,`classId`,`divisionId`,`teacherId`,`asOf`,`history`) · `POST /teacher-assignments` (assign) · `POST /teacher-assignments/:id/change` `{newTeacherId,effectiveFrom,reason}` · `POST /:id/end` | `teacherAssignment.view|assign|change` |
| **students** | `GET /students` (search + filters + `feeStatus`) · **`POST /students`** (admission command, §10) · `GET/PATCH /students/:id` · `POST /students/:id/status` · `POST /students/duplicate-check` · `GET /students/:id/360` (header + summaries) · `GET /students/:id/{academic-history,fees,payments,receipts,reminders,audit}` | `student.view|create|update|archive` (+`student.viewContact`) · scope |
| **enrollments** | `GET /enrollments` · `POST /enrollments` (enrol existing student in a year) · `POST /enrollments/:id/change-division` · `POST /enrollments/:id/cancel` | `enrollment.manage` · scope |
| **promotions** | `POST /promotions/batches` (draft) · `GET /promotions/batches/:id` · `PUT /:id/decisions` · `POST /:id/preview` · `POST /:id/commit` · `POST /:id/cancel` | `promotion.run` |
| **fee-components** | `GET/POST /fee-components` · `PATCH /:id` | `feeStructure.view|manage` |
| **fee-structures** | `GET/POST /fee-structures` · `GET /:id` · `POST /:id/versions` (new DRAFT from current) · `PATCH /fee-versions/:id` (DRAFT only) · `POST /fee-versions/:id/publish` · `GET /fee-structures/:id/compare?a=&b=` · `POST /fee-structures/clone-year` | `feeStructure.view|manage|publish` |
| **fees (engine)** | **`POST /fees/preview`** (student-addition preview — §10) · `POST /fee-assignments` · `POST /fee-assignments/:id/reassign` (BRC-C3) · `GET /fee-assignments?studentId` | `feeAssignment.view|manage` |
| **installments** (receivables of kind INSTALLMENT/PENALTY) | `GET /installments` (`studentId`,`academicYearId`,`classId`,`divisionId`,`status`,`dueFrom`,`dueTo`,`component`) · `GET /installments/:id` · `POST /installments/:id/restructure` · `POST /installments/:id/reschedule` (due date) | `installment.view|modify` · scope |
| **opening-balances** | `GET /opening-balances` · `GET /:id` · `POST /opening-balances` · `POST /:id/reverse` | `openingBalance.view|create|reverse` |
| **adjustments** | `GET /adjustments` · `POST /adjustments` (request / auto-approved if threshold) · `POST /:id/approve|reject|reverse` · `GET /adjustments/approvals` | `adjustment.view|create|approve|reverse` |
| **late-fees** | `GET/POST/PATCH /late-fee-policies` · `POST /late-fees/run` (manual trigger, admin) · `POST /late-fees/waive` | `lateFee.manage|waive` |
| **payments** | `GET /payments` · `GET /payments/:id` · **`POST /payments`** (collect — §11) · `POST /payments/allocation-preview` · `POST /payments/:id/reverse` (request) · `POST /payment-reversals/:id/approve|reject` · `PATCH /payments/:id/meta` | `payment.view|collect|allocateManual|backdate|reverse|reverseApprove|editMeta` |
| **payment-allocations** | `GET /payment-allocations?paymentId|receivableId` (read-only ledger) | `payment.view` |
| **receipts** | `GET /receipts` · `GET /receipts/:id` · `GET /receipts/:id/pdf` · `POST /receipts/:id/print-log` | `receipt.view|reprint` |
| **outstanding** | `GET /outstanding?groupBy=student|class|division|teacher|year|feeType|installment` · `GET /outstanding/overdue` · `GET /outstanding/aging` · `GET /outstanding/students/:id` | `outstanding.view` · scope |
| **reminders** | `GET/POST/PATCH /reminder-templates` · `GET/POST/PATCH /reminder-rules` · `POST /reminders/audience-preview` · `POST /reminders/campaigns` · `GET /reminders/queue` (scheduled) · `GET /reminders` (history) · `POST /reminders/:id/cancel|retry` · `POST /webhooks/:provider` (signature-verified delivery receipts) | `reminder.view|send|manage` · scope |
| **dashboard** | `GET /dashboard/{kpis,collection-trend,expected-vs-actual,outstanding-trend,class-performance,division-performance,teacher-distribution,payment-status,aging,targets,forecast,recovery}` | `dashboard.view` · scope |
| **targets** | `GET/POST/PATCH/DELETE /collection-targets` | `target.manage` |
| **reports** | `GET /reports` (catalog filtered by permission) · `GET /reports/:key` (JSON, paginated) · `POST /reports/:key/export` `{format,filters}` → `200` stream **or** `202 {jobId}` · `GET /exports/:jobId` · `GET /exports/:jobId/download` | `report.view` / `report.export` |
| **imports** | `GET /imports/templates/:type` · `POST /imports` (multipart; stage) · `GET /imports/:id` · `GET /imports/:id/rows?status=` · `GET /imports/:id/errors.csv` · `POST /imports/:id/confirm` · `POST /imports/:id/commit` · `POST /imports/:id/cancel` | `import.run`, `import.commit` |
| **search** | `GET /search?q=` → grouped hits: students, receipts, (teachers) | any authenticated + `student.view` · scope |
| **audit-logs** | `GET /audit-logs` (cursor; filters: entity, user, action, date) · `GET /audit-logs/:id` · `POST /audit-logs/export` | `audit.view` |
| **ops** | `GET /healthz` · `GET /readyz` · `GET /version` | public (no data) |

### 5.4 Special command contracts (the ones that must be exactly right)

**`POST /fees/preview`** — pure, side-effect-free, same engine as the commit path.
```jsonc
// request
{ "academicYearId": "…", "classId": "…", "divisionId": "…", "categoryId": "…",
  "planCode": "INST4", "optionalComponentIds": ["transport"],
  "openingBalance": { "amount": 1000000, "effectiveDate": "2026-04-01" },
  "concessions": [{ "type": "CONCESSION", "mode": "FIXED", "value": 500000, "distribution": "LATEST_FIRST" }],
  "historicalPayments": [{ "amount": 2000000, "paymentDate": "2026-04-12", "method": "CASH" }],
  "customInstallments": null }
// response
{ "structure": { "id": "…", "versionNo": 3, "name": "Class 5 · General · 2026-27" },
  "lines": [ … ], "installments": [{ "no": 1, "dueDate": "2026-04-10", "payable": 1250000, "adjusted": 0, "paid": 1000000, "pending": 250000, "status": "OVERDUE" }, …],
  "summary": { "applicableFee": 5000000, "openingBalance": 1000000, "penalties": 0, "concession": 500000,
               "alreadyPaid": 2000000, "currentOutstanding": 3500000,
               "overdue": 1500000, "nextInstallment": { "no": 3, "payable": 1250000, "dueDate": "2026-10-10" } },
  "warnings": [{ "code": "OPENING_BALANCE_OVERDUE_ON_ENTRY", "message": "…" }],
  "previewHash": "sha256:…", "asOf": "2026-10-08" }
```
**`POST /students`** accepts the same financial inputs **plus** `previewHash`. The server **recomputes**; if the result differs from the hash the user confirmed (fee structure republished, due dates edited by someone else) → `409 PREVIEW_STALE` with the fresh preview, so *what the user saw is what is saved*.

**`POST /payments`** — header `Idempotency-Key`; body: `studentId`, `amount`, `method`, `reference`, `paymentDate?`, `allocation: { mode: "AUTO" | "MANUAL", items?: [{receivableId, amount}] }`, `remarks?`, `confirmDuplicate?`. Response: `{ payment, receipt, allocations, studentBalance }` — the UI updates without a second fetch.

### 5.5 Async operations

`202 Accepted` + `{ jobId, statusUrl }` for large exports, PDF packs, imports validation/commit, promotion commits, campaign fan-out. Clients poll `GET /exports/:id` (or `/imports/:id`) every 2 s with back-off; completion also creates an in-app `Notification`.

### 5.6 Webhooks (inbound)

`POST /webhooks/:provider` — raw body, **HMAC signature verified**, replay-window checked, idempotent by `providerMessageId + event`. Updates `reminders.status` (DELIVERED/READ/FAILED). No auth cookie, strict rate-limit.

---

## 6. RBAC

### 6.1 Model

```
User ──* Role ──* PermissionKey (code registry)      effective permissions = union of roles
                └─ dataScope: ALL | OWN_DIVISIONS     OWN_DIVISIONS ⇒ resolved via current TeacherAssignment(s) of user.teacherId
```
- **Authorization is evaluated per request from server-side state.** The JWT carries only `sub`, `sid`, `tokenVersion`, `exp`. The Principal (roles → permissions, scope, status) is loaded from a Redis cache (TTL 60 s, **invalidated immediately on role/user change**). Deactivating a user or bumping `tokenVersion` takes effect within one request.
- **Two layers, both mandatory:** (1) route-level `authorize('payment.collect')`; (2) **object/data scope** inside the repository (`scopeFilter(principal)`) so teachers can't fetch another division by ID (returns 404, not 403).
- **No deny rules** (union only) — simpler to reason about and audit. A *custom role builder* with a permission matrix UI is provided; system roles are copy-on-edit.
- **Sensitive financial operations have extra controls** beyond the permission (6.4).

### 6.2 Permission catalogue (code registry; `GET /permissions` serves it with labels)

```
institution.view · institution.manage · settings.view · settings.manage
user.view · user.manage · role.view · role.manage · audit.view · audit.export
academicYear.view · academicYear.manage · academicYear.close · academicYear.override (post into closed year)
class.view · class.manage · division.view · division.manage
teacher.view · teacher.create · teacher.update · teacher.deactivate
teacherAssignment.view · teacherAssignment.assign · teacherAssignment.change
student.view · student.viewContact · student.create · student.update · student.archive · student.export
enrollment.manage · promotion.run
feeStructure.view · feeStructure.manage · feeStructure.publish
feeAssignment.view · feeAssignment.manage
installment.view · installment.modify
openingBalance.view · openingBalance.create · openingBalance.reverse
adjustment.view · adjustment.create · adjustment.approve · adjustment.reverse
lateFee.manage · lateFee.waive
payment.view · payment.collect · payment.allocateManual · payment.backdate · payment.editMeta
payment.reverse (request) · payment.reverseApprove
receipt.view · receipt.reprint
outstanding.view · dashboard.view · target.manage
reminder.view · reminder.send · reminder.manage (rules, templates)
report.view · report.export
import.run · import.commit
```

### 6.3 Role matrix (system roles; all editable via custom roles)

Legend: ● full · ◐ limited (see note) · ○ view only · — none. **Scope:** `ALL` except Class Teacher = `OWN_DIVISIONS`.

| Capability | Super Admin | Admin / Principal | Accountant | Fee Collector | Registrar | Class Teacher | Comms Officer | Auditor |
|---|---|---|---|---|---|---|---|---|
| Institution & settings | ● | ○ + settings.view | ○ | — | ○ | — | — | ○ |
| Users, roles | ● | ○ | — | — | — | — | — | ○ |
| Academic years / classes / divisions | ● | ● (close year ●) | ○ | ○ | ● | ○ own | ○ | ○ |
| Teachers & assignments | ● | ● | ○ | ○ | ● | ○ own | ○ | ○ |
| Students (create/edit/archive) | ● | ● | ○ | ○ | ● | ○ own | ○ | ○ |
| Student contact details | ● | ● | ● | ● | ● | ● own | ● | ● |
| Promotion / enrollment | ● | ● | — | — | ● | — | — | — |
| Fee structures (draft) | ● | ● | ● | ○ | ○ | — | — | ○ |
| Fee structures (**publish**) | ● | ● | — | — | — | — | — | — |
| Fee assignment / reassign | ● | ● | ● | — | ◐ at admission | — | — | ○ |
| Opening balance create | ● | ● | ● | — | ◐ at admission (if granted) | — | — | ○ |
| Opening balance reverse | ● | ● | ● | — | — | — | — | — |
| Adjustment request | ● | ● | ● | ◐ | — | — | — | — |
| Adjustment **approve** | ● | ● | — | — | — | — | — | — |
| Late-fee policy / waive | ● | ● | ◐ waive request | — | — | — | — | ○ |
| **Collect payment** | ● | — | ● | ● | — | — | — | — |
| Manual allocation | ● | — | ● | — | — | — | — | — |
| Back-dated payment | ● | — | ● | — | — | — | — | — |
| **Reverse payment (request)** | ● | ● | ● | — | — | — | — | — |
| **Reverse payment (approve)** | ● | ● | — | — | — | — | — | — |
| Receipts view / reprint | ● | ● | ● | ● | ○ | ○ own | — | ○ |
| Outstanding / overdue / aging | ● | ● | ● | ○ | — | ○ own | ○ | ● |
| Reminders – send | ● | ● | ● | — | — | ◐ own (if granted) | ● | — |
| Reminders – rules & templates | ● | ● | — | — | — | — | ● | ○ |
| Dashboard | ● | ● | ● | ◐ own collections | ○ academic only | ◐ own division | ◐ | ● |
| Reports – view | ● | ● | ● | ◐ own collections | ◐ academic | ◐ own division | ◐ reminders | ● |
| Reports – export | ● | ● | ● | — | ◐ | — | ◐ | ● |
| Imports – run | ● | ● | ◐ finance types | — | ◐ academic types | — | — | — |
| Imports – **commit** | ● | ● | ◐ finance (needs Admin approval toggle) | — | ◐ academic | — | — | — |
| Audit logs | ● | ● | — | — | — | — | — | ● |
| Collection targets | ● | ● | ○ | — | — | — | — | ○ |

*Matrix is a **seed**; the final matrix is a client decision (BRC-J1).*

### 6.4 Controls on sensitive financial operations

| Operation | Controls |
|---|---|
| **Collect payment** | `payment.collect`; amount ≤ pending unless `advance.enabled`; unique reference rule; `Idempotency-Key`; audit; daily collector totals visible to the collector (day-book). |
| **Back-dated payment** | `payment.backdate` and `paymentDate ≥ today − payment.backdateMaxDays`; closed academic year needs `academicYear.override`; always flagged on the receipt/report. |
| **Reverse payment** | Request needs `payment.reverse` + mandatory reason code/text. If `reversal.approval.required` (default **on** above a threshold) the reversal stays `PENDING_APPROVAL` until a *different* user with `payment.reverseApprove` approves (`sameUserAllowed=false`). Receipt is cancelled, number retained. |
| **Discount / waiver** | Request needs `adjustment.create`; applied only after `adjustment.approve` (requester ≠ approver) or auto-approved below a configured threshold. |
| **Opening balance** | `openingBalance.create`; reason mandatory; reversal needs `openingBalance.reverse`. |
| **Fee structure publish** | Separate from edit; diff view shown; reason required; affects only *new* assignments unless a BRC-C3 re-pricing job is explicitly approved. |
| **Close / override academic year** | `academicYear.close` / `academicYear.override`; override logged with reason. |
| **Export** | `report.export`; audited (who, filters, row count); PII columns respect `student.viewContact`. |
| **Role/permission change** | `role.manage`; before/after diff audited; affected sessions invalidated. |

### 6.5 Authentication & session design

1. **Login** `POST /auth/login` → verifies Argon2id hash (constant-time, uniform timing/message for unknown email), lockout after N failures (progressive), IP+email rate limit → returns **access JWT (15 min)** in body; **refresh token** (opaque 256-bit random) in httpOnly cookie; server stores only its **hash** in `sessions`.
2. **Refresh** `POST /auth/refresh` — cookie + custom header `X-Requested-With: fetch` + `Origin` check (CSRF). **Rotation on every use** with **reuse detection**: presenting an already-rotated token revokes the entire `familyId` and forces re-login. Idle timeout 8 h sliding, absolute 7 days (configurable — SOW §48 "session controls").
3. **Access token lives in memory only** (never localStorage). Page reload → silent refresh. Multi-tab single-flight refresh via `BroadcastChannel` lock to avoid reuse-detection false positives.
4. **Password policy:** ≥ 10 chars, breached-password check (k-anonymity list, offline), forced change on first login and on admin reset; **optional TOTP MFA** (enforced for Super Admin / Accountant / Admin roles — Phase 18).
5. **Logout-all / session list / revoke**; `tokenVersion` bump on password change or role change.
6. JWT: pinned algorithm (`EdDSA` or `HS256` with ≥ 256-bit secret), `iss`/`aud` validated, `kid` for rotation.
