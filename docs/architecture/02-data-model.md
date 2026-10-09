# 3 · Complete MongoDB Data Model  &  4 · Entity Relationships

## 3.1 Modelling principles (apply to every collection)

| Rule | Detail |
|---|---|
| **IDs** | `_id: ObjectId`. Human IDs (`studentId`, `teacherCode`, `receiptNo`, `paymentNo`) come from the `counters` collection. Receipt numbers are **unique and never reused; gaps are allowed** (decision BRC-G1; format `REC-2026-000001`). Other formats are configurable (BRC-B1). |
| **Tenancy** | `institutionId` on every business document, first field of every compound index. |
| **Money** | Integer **paise** (`Number.isSafeInteger` enforced by Zod + Mongoose validator). Percent = basis points. Field names carry the unit only when ambiguous: `amount`, `payable`, `paid`… are always paise. |
| **Dates** | `BusinessDate` = `"YYYY-MM-DD"` string in institution TZ for `dueDate`, `paymentDate`, `effectiveDate`, `dob`, `admissionDate`, `startDate`… Timestamps (`createdAt`, `receivedAt`) are UTC `Date`. Strings sort and range-query correctly, avoid TZ drift. |
| **Audit columns** | `createdAt, createdBy, updatedAt, updatedBy`; `version` (int) on mutable masters. |
| **No hard deletes** | Masters: `status`/`isActive` + archive. Finance: never deleted or edited — see 3.4. |
| **Snapshots vs references** | Reference for *live* relationships; **snapshot** (copy) wherever a historical document must read the same forever (receipt, fee assignment lines, reminder message, guardian contact used). |
| **Index discipline** | Every list/filter/sort used by a screen has a supporting index; key queries are covered by an `explain()` test asserting *no COLLSCAN* (§17). |
| **DTO ≠ schema** | API shapes (Zod, shared) are separate from Mongoose schemas; mappers convert paise↔display, hide internals. |

## 3.2 Embedding vs referencing — decisions

| Relationship | Decision | Reason |
|---|---|---|
| Student → parents | **Reference** (`parents` collection) + embedded link `{parentId, relation, isPrimary, isFeeContact}` | Decided by the client: siblings share one parent record (single place to change a mobile), family-wise outstanding, future parent portal. The link is embedded because it is bounded (≤3) and the relation belongs to the student–parent pair. |
| Student → address | **Embed** | Value object. |
| Student → enrollments | **Reference** (`student_enrollments`) | Unbounded over 15 years; queried by division/year for rosters. |
| Fee structure → versions | **Reference** | Versions are immutable documents with their own lifecycle. |
| Version → fee lines, installment plans | **Embed** | Bounded (≤ ~20 lines, ≤ ~12 installments × plan), versioned *as a unit* (content-hashed). |
| Fee assignment → lines (snapshot) | **Embed** | Frozen copy of what this student was charged; per-student overrides (e.g., transport opt-out). |
| Receivable → components | **Embed** (with per-component `payable/adjusted/paid`) | Needed for fee-type-wise outstanding; bounded; updated atomically with the receivable. |
| Payment → allocations | **Reference** (`payment_allocations`) | Append-only ledger rows; aggregated across payments/dates/classes. |
| Allocation → component split | **Embed** | Bounded; avoids row explosion (installments × components). |
| Receipt → everything printed | **Embed snapshot** | A reprint 5 years later must be identical. |
| Adjustment → applications | **Embed** (`applications[]`) | Which receivables/components it reduced; bounded. |
| Reminder → guardian contact, message | **Embed snapshot** | Legal/communication traceability. |
| Audit → before/after | **Embed** (field-level diff) | Self-contained evidence. |
| Teacher ↔ Division per year | **Reference** (`teacher_assignments`, effective-dated) | Many-to-many over time; needs history. |
| Class/Division names in lists | **Reference + API-side cached lookup** | Tiny, cached maps; avoids stale denormalized names. |
| Hot aggregates (student balance) | **Derived read model** (`student_year_balances`) recomputed in-transaction from receivables | List/sort/filter by outstanding at scale without joins; never the source of truth. |

---

## 3.3 Collections

> Notation: `?` optional · `[]` array · `→` reference · **bold index** = unique.
> Standard columns (`institutionId, createdAt, createdBy, updatedAt, updatedBy`) omitted unless special.

### A. Platform / configuration

```ts
Institution {                       // exactly one per deployment (v1)
  name, shortName, code, logoFileId?, address{line1,line2?,city,state,pincode,country},
  contact{phone,altPhone?,email,website?}, registrationNo?,
  timezone: 'Asia/Kolkata', currency: 'INR', academicStartMonth: 4,
  receiptFooter?, extra: Record<string,string>     // "other configurable details" (SOW §3)
}

SystemSetting { key, value, schemaVersion }        // typed by a Zod registry per key
//  keys: dueSoonDays, allocation.strategy, allocation.componentSplit, advance.enabled,
//        payment.backdateMaxDays, payment.methods[], reversal.approval.thresholdPaise (null = off), teacher.allowMultipleDivisions,
//        adjustment.approval{thresholdPaise}, receipt.numbering{prefix,series,resetPolicy,pad}, id.formats{…},
//        lateFee.materialize, aging.basis, notification.quietHours, student.customFieldDefs[] …
//  index: **(institutionId, key)**.   Every change is audited (previous/new).

Counter { _id: "<institutionId>:<seriesKey>", seq }  // atomic findOneAndUpdate $inc OUTSIDE the transaction: never conflicts, never rolled back → gaps possible, reuse impossible (BRC-G1)

File { key, bucket, mime, size, sha256, kind: LOGO|RECEIPT_PDF|EXPORT|IMPORT|PHOTO, ownerType?, ownerId?, expiresAt? }
//  index: **(bucket,key)**, (ownerType,ownerId), TTL-style cleanup by expiresAt (job)
```

### B. Academic structure

```ts
AcademicYear {
  label: "2026-27", startDate, endDate,
  status: PLANNED | ACTIVE | CLOSED,     // CLOSED = locked: financial postings need `academicYear.override`
  isCurrent: boolean, closedAt?, closedBy?
}
// **(institutionId,label)** · **partial unique (institutionId) where isCurrent:true** · (institutionId,startDate)
// Service rule: date ranges may not overlap.

Class {                                   // year-independent master
  code: "5", name: "Class 5", sequence: 5, isActive, isFinal: boolean   // isFinal → passes out instead of promoting
}
// **(institutionId,code)** · **(institutionId,sequence)**

Division {                                // YEAR-SCOPED  (decision D6)
  academicYearId→, classId→, name: "A", capacity?, isActive
}
// **(academicYearId,classId,name)** · (academicYearId,classId,isActive)
// "Clone structure from previous year" copies divisions (and optionally teacher assignments as drafts).

StudentCategory { code, name, isActive, sequence }       // GENERAL, STAFF_WARD, SIBLING, RTE … (BRC-B2)
// **(institutionId,code)**
```

### C. Teachers (new requirement #1)

```ts
Teacher {
  teacherCode: "TCH-000012",            // system Teacher ID
  staffId: string,                      // Employee/Staff ID (client's own)
  fullName, nameSearch(normalized), mobile, email?, gender?,
  qualification?, joiningDate, status: ACTIVE | INACTIVE | LEFT, leavingDate?, remarks?,
  userId?→User                          // optional login link (BRC-B6)
}
// **(institutionId,teacherCode)** · **(institutionId,staffId)** · (institutionId,status,nameSearch) · (institutionId,mobile)

TeacherAssignment {                     // effective-dated, never overwritten
  academicYearId→, classId→, divisionId→, teacherId→,
  role: CLASS_TEACHER,                  // enum extensible (SUBJECT_TEACHER later)
  effectiveFrom, effectiveTo?, isCurrent: boolean,
  endReason?: CHANGED | LEFT_INSTITUTION | CORRECTION | YEAR_END,
  replacesAssignmentId?→, assignedBy→User, reason?
}
// **partial unique (divisionId, role) where isCurrent:true**      ← one current class teacher per division, DB-enforced
// (teacherId, academicYearId, isCurrent) · (academicYearId, classId, divisionId, effectiveFrom) · (teacherId, effectiveFrom)
```

### D. Students & academic history

```ts
Student {
  studentId: "STU-000123",              // system ID
  admissionNo: string,                  // client's number
  firstName, middleName?, lastName, fullName, searchTokens[] (lower, diacritics-stripped),
  dob, gender, categoryId→,             // category = *current*; enrollment/assignment keep snapshots
  guardians: [{ parentId→Parent, relation, isPrimary, isFeeContact }],  // exactly 1 primary; relation belongs to the LINK
  parentIds[]: flat copy of guardians[].parentId (siblings / family-wise outstanding),
  email?, address{…}, admissionDate, photoFileId?,
  status: ACTIVE | INACTIVE | TRANSFERRED | WITHDRAWN | PASSED_OUT | ARCHIVED, statusReason?, statusChangedAt?,
  current: { enrollmentId→, academicYearId→, classId→, divisionId→ },   // PROJECTION (rebuildable), updated in the enrollment txn
  customFields: Record<string,string|number|boolean>,                    // "other configurable information" (SOW §7)
  version
}
// **(institutionId,studentId)** · **(institutionId,admissionNo)**
// (institutionId,status,'current.academicYearId','current.classId','current.divisionId')
// (institutionId,searchTokens) multikey · (institutionId,parentIds) multikey
// (institutionId,dob,searchKeyNormalized) — duplicate-student heuristic

Parent {                                // DECIDED (client): separate collection, one document per real person, shared by siblings
  fullName, nameSearch, mobile (normalized last 10 digits), altMobile?, email?, occupation?, address{…},
  status: ACTIVE | INACTIVE, userId?→User (reserved for the parent portal, not in release 1), version
}
// **(institutionId,mobile)** unique → admission finds "this parent already exists" · (institutionId,status,nameSearch)
// sparse (institutionId,altMobile) · sparse (institutionId,email)
// Mobile/email change in ONE place. Reminders still store a guardian snapshot (name/mobile/email at send time).
// Search by mobile / parent name: Parent lookup → students by `parentIds`.

StudentEnrollment {                     // ACADEMIC TRUTH (decision D7)
  studentId→, academicYearId→, classId→, divisionId→, rollNo?,
  type: NEW_ADMISSION | PROMOTION | REPEAT | READMISSION | MIGRATION,
  status: ACTIVE | ENDED | CANCELLED,
  endReason?: PROMOTED | REPEATED | PASSED_OUT | TRANSFERRED_OUT | WITHDRAWN | DIVISION_CHANGE | CORRECTION,
  isCurrent: boolean,                   // latest non-cancelled row for (student, year)
  categoryId→ (snapshot), enrolledOn, endedOn?, previousEnrollmentId?→, promotionBatchId?→
}
// **partial unique (studentId, academicYearId) where isCurrent:true**   ← no duplicate enrollment per year
// (institutionId, academicYearId, divisionId, isCurrent) · (studentId, academicYearId, enrolledOn) · (promotionBatchId)

PromotionBatch {
  fromAcademicYearId→, toAcademicYearId→, scope{classIds?,divisionIds?},
  rules{ divisionMapping: [{fromDivisionId→, toDivisionId→?}], autoAssignFees: boolean },
  decisions: [{ studentId→, action: PROMOTE|REPEAT|PASS_OUT|HOLD, toClassId?, toDivisionId?, warnings[] }],   // ≤ chunked
  status: DRAFT | PREVIEWED | RUNNING | COMPLETED | PARTIAL | CANCELLED,
  counts{total,promoted,repeated,passedOut,held,failed}, createdBy, committedAt?
}
// (institutionId,toAcademicYearId,status)
```

### E. Fee configuration (versioned)

```ts
FeeComponent {                          // master list of fee types
  code, name, kind: TUITION|ADMISSION|EXAMINATION|TRANSPORT|ACTIVITY|LIBRARY|LABORATORY|MISC|CUSTOM
                   |OPENING_BALANCE|LATE_FEE,          // last two are isSystem
  isSystem, isOptionalByDefault, isActive, sequence
}
// **(institutionId,code)**

FeeStructure {                          // the stable "slot": year × class × division? × category?
  academicYearId→, classId→, divisionId?→ (null = all), categoryId?→ (null = all),
  name, status: ACTIVE | ARCHIVED, currentVersionId?→, latestVersionNo
}
// **(institutionId, academicYearId, classId, divisionId, categoryId)**   (nulls compare equal → no duplicate slot)

FeeStructureVersion {                   // IMMUTABLE once PUBLISHED (decision D8)
  structureId→, academicYearId→ (denorm), versionNo, status: DRAFT | PUBLISHED | SUPERSEDED,
  effectiveFrom, changeReason?, publishedAt?, publishedBy?, supersededAt?, contentHash,
  lines: [{ componentId→, code, name, amount, isOptional, sequence }],
  plans: [{                              // "Full payment", "4 installments", "Monthly" …
    planCode, name, isDefault,
    installments: [{ no, label, dueDate,
       componentSchedule: [{ componentCode, mode: PERCENT_BP|FIXED|REMAINDER, value }] }]   // → installment-specific components (SOW §12)
  }],
  lateFeePolicyId?→
}
// **(structureId,versionNo)** · (structureId,status)
// Publish-time validation: for every plan, each component's schedule sums exactly to the component amount.

FeeAssignment {                         // "this student is billed per this version for this year"
  studentId→, academicYearId→, enrollmentId→, classId→, divisionId→, categoryId→ (snapshots),
  structureId→, structureVersionId→, planCode, planMode: STANDARD | FULL | CUSTOM,
  lines: [{ componentId→, code, name, amount, isOptional, included }],   // snapshot + per-student overrides
  grossAmount,                           // Σ included lines — the *fee* (excludes opening balance & penalties)
  status: ACTIVE | CANCELLED | VOID, supersedesAssignmentId?→, source: ADMISSION|PROMOTION|IMPORT|MANUAL|REASSIGNMENT,
  assignedAt, assignedBy, cancelReason?, version
}
// **partial unique (studentId, academicYearId) where status:'ACTIVE'**  ← no duplicate fee assignment
// (structureVersionId) · (academicYearId,classId,divisionId,status)

LateFeePolicy {                        // versioned; a new version never rewrites posted penalties (decision BRC-F1)
  name, mode: FIXED | PER_DAY | PERCENT, valuePaise?, valueBp?,
  graceDays (default 0), capPaise? (total penalties per parent receivable),
  appliesToKinds[] (default ['INSTALLMENT']), applyToOpeningBalance (default false),
  installmentOverrides?: { [installmentNo]: { mode?, valuePaise?, valueBp?, graceDays?, capPaise? } },
  scope{academicYearId?,classIds?}, effectiveFrom, effectiveTo?, isActive, version
}
```

### F. Receivables ledger (core)

```ts
Receivable {                            // ONE payable unit (decision D2)
  studentId→, academicYearId→, classId→, divisionId→ (reporting dimensions; synced on division move),
  kind: INSTALLMENT | OPENING_BALANCE | PENALTY | ADHOC,          // ADHOC reserved (BRC-F1)
  sourceType: FEE_ASSIGNMENT | OPENING_BALANCE | LATE_FEE_POLICY | MANUAL, sourceId,
  installmentNo?, label: "Installment 2" | "Opening balance" | "Late fee – Inst. 2",
  dueDate, originalDueDate, dueDateHistory: [{from,to,reason,by,at}],
  parentReceivableId?→ (penalty → the installment it penalises), periodKey? (e.g. "2026-10-15" / "2026-W42"),
  components: [{ componentId→, code, name, payable, adjusted, transferred, paid }],
  payable, adjusted, transferred, paid, pending,   // = Σ components; pending = payable − adjusted − transferred − paid (stored, guarded)
  // `transferred` = amount moved to a later year by a manual, audited carry-forward (decision BRC-D1); NOT a discount, NOT collected
  hasPendingAdjustment: boolean,         // drives the PAID vs PENDING_ADJUSTMENT status (decision BRC-I1)
  paymentStatus: UNPAID | PARTIAL | PAID | WAIVED | TRANSFERRED | VOID,   // WAIVED = fully adjusted; TRANSFERRED = remainder carried forward (BRC-D1)
  restructuredFromId?→, restructureSeq?, dedupeKey, voidReason?, version
}
// Invariant: payable ≥ 0; adjusted+transferred+paid ≤ payable; pending = payable−adjusted−transferred−paid ≥ 0  (Mongo $expr validator + engine)
// **(institutionId,dedupeKey)** where dedupeKey = `${sourceType}:${sourceId}:${installmentNo ?? 0}:${parentReceivableId ?? ''}:${periodKey ?? ''}`
//   → no duplicate installment for the same assignment, no duplicate opening-balance receivable, no duplicate penalty for a period
//   (one plain unique index instead of several partial ones; restructured children get a new `restructureSeq` in the key)
// (studentId,academicYearId,paymentStatus,dueDate) — Student 360 / collection screen
// (institutionId,academicYearId,classId,divisionId,paymentStatus)
// partial (institutionId,dueDate) where pending>0 — overdue / due-soon / reminder scans
// (institutionId,kind,academicYearId)

OpeningBalance {                        // business record behind kind=OPENING_BALANCE (requirement #3)
  studentId→, academicYearId→, amount (>0), effectiveDate, dueDate (default = effectiveDate),
  source: MIGRATION | MANUAL | ADMISSION | CARRY_FORWARD (manual, audited, never automatic — decision BRC-D1), reason, remarks?, importRef?{batchId,rowNo},
  carryForwardFrom?: [{ receivableId→, academicYearId→, amount }],
  receivableId→, status: ACTIVE | REVERSED, reversal?{at,by,reason}, createdBy, createdAt
}
// **partial unique (studentId, academicYearId) where status:'ACTIVE'**  ← no duplicate opening balance
// (institutionId, academicYearId, source) · (importRef.batchId)

Adjustment {                            // discounts / scholarships / concessions / waivers (SOW §39)
  studentId→, academicYearId→,
  type: SCHOLARSHIP | DISCOUNT | CONCESSION | WAIVER | PENALTY_WAIVER | OTHER,
  calc{ mode: FIXED|PERCENT_BP, value, basis: TOTAL_FEE|COMPONENT|RECEIVABLE, componentCode?, receivableId? },
  amount,                                // resolved total in paise (engine-computed)
  applications: [{ receivableId→, componentCode, amount }],
  distribution: PROPORTIONAL | EARLIEST_FIRST | LATEST_FIRST | SPECIFIC,   // BRC-F2
  reason, remarks?, effectiveDate,
  status: PENDING_APPROVAL | APPROVED | REJECTED | REVERSED,
  requestedBy, requestedAt, approvedBy?, approvedAt?, rejectedReason?, reversal?{at,by,reason}
}
// (studentId,academicYearId,status) · (status,requestedAt) approval queue · (institutionId,type,approvedAt)
// Only APPROVED adjustments are reflected in receivable.adjusted. Original `payable` is never touched → "original fee traceable".
```

### G. Payments, allocations, receipts

```ts
Payment {                               // IMMUTABLE fact (only `status` / `reversalId` transition)
  paymentNo: "PAY-2026-000451" (transaction number), studentId→,
  amount, allocatedAmount, unallocatedAmount (advance credit, BRC-E2),
  method: <code from settings>, reference{ type, number?, bank?, chequeDate?, note? },
  uniqueRefKey?: "UPI|<norm ref>" | "CHQ|<bank>|<no>",   // present only when the method requires uniqueness; UNSET on reversal so a corrected re-entry is possible
  paymentDate (business), receivedAt, collectedBy→User,
  source: COUNTER | HISTORICAL | IMPORT | ADVANCE_ADJUSTMENT,
  allocationMode: AUTO | MANUAL, allocationStrategy: 'OLDEST_DUE_FIRST'|… (the order actually used), remarks?, idempotencyKey,
  status: POSTED | REVERSED, receiptId→, reversalId?→
}
// **(institutionId,paymentNo)** · **(institutionId,idempotencyKey)** · **partial unique (institutionId,uniqueRefKey) where uniqueRefKey exists**
// (studentId,paymentDate) · (institutionId,paymentDate,collectedBy) · (institutionId,paymentDate,method) · (receiptId)

PaymentAllocation {                     // IMMUTABLE ledger row
  paymentId→, studentId→, receivableId→, academicYearId→, classId→, divisionId→ (dimensions at posting),
  kind: ALLOCATION | REVERSAL,
  amount: signed paise (REVERSAL rows are negative),
  componentSplit: [{ componentCode, amount }],
  reversesAllocationId?→,
  postingDate (business: payment date for ALLOCATION, reversal date for REVERSAL — BRC-E6), createdAt, createdBy
}
// (paymentId) · (receivableId) · (institutionId,postingDate,classId,divisionId) · (studentId,postingDate)
// Paid(receivable) = Σ allocation.amount  — the receivable.paid counter is a guarded cache of this sum (reconciled nightly).

PaymentReversal {                      // powers the Reversal Report (decision BRC-E6)
  paymentId→ (unique), reasonCode, reasonText (mandatory), requestedBy, requestedAt,
  originalPaymentDate, originalAmount, reversalDate, reversedAmount,        // report columns (full reversal in v1 → reversedAmount = originalAmount)
  approvalRequired (set from settings.reversal.approval.thresholdPaise; null threshold → false),
  approvedBy?, approvedAt?, rejectedBy?, rejectedReason?, authorizedBy (approver if approval flow, else performing user),
  status: PENDING_APPROVAL | COMPLETED | REJECTED, completedAt?, refund?{mode,reference,by,at}, idempotencyKey
}
// **(paymentId)** · (status,requestedAt)

Receipt {                               // IMMUTABLE snapshot
  receiptNo, series, paymentId→ (unique), studentId→, academicYearId→,
  status: ISSUED | CANCELLED, issuedAt, issuedBy,
  snapshot{ institution{name,logoFileId,address,contact,receiptFooter},
            student{studentId,admissionNo,name,guardianName},
            academic{yearLabel,className,divisionName,classTeacherName?},
            lines:[{ label, dueDate?, components:[{name,amount}], amountPaid }],
            payment{method,reference,date,amount,paymentNo},
            balances{ previousBalance, paidNow, remainingBalance, creditBalance? },
            collectedByName },
  pdf?{ fileId, templateVersion, hash }, printCount, lastPrintedAt?,
  cancellation?{ at, by, reason }
}
// **(institutionId,receiptNo)** (never reused) · **(paymentId)** · (studentId,issuedAt)    // receiptNo e.g. "REC-2026-000001"; users can never supply it
```

### H. Derived read models

```ts
StudentYearBalance {                    // recomputed IN the same transaction from the student's receivables (≤ ~12 docs) — never incremented
  studentId→, academicYearId→, classId→, divisionId→,
  grossFee, openingBalance, penalties, adjustments, netReceivable, paid, pending, creditBalance,
  earliestPendingDueDate?,               // TIME-INDEPENDENT; "overdue" = earliestPendingDueDate < today (evaluated at query time)
  paymentState: UNPAID | PARTIAL | PAID | WAIVED, lastPaymentDate?, version
}
// **(studentId,academicYearId)** · (institutionId,academicYearId,classId,divisionId,pending)
// partial (institutionId,academicYearId,earliestPendingDueDate) where pending>0

DailySnapshot {                         // nightly; powers outstanding/aging TRENDS (history can't be re-derived cheaply)
  date, academicYearId→, classId→, divisionId→, students, grossFee, openingBalance, penalties, adjustments,
  netReceivable, collectedToDate, pending, overdue, aging{notDue,d1_30,d31_60,d61_90,d90p}
}
// **(institutionId,date,academicYearId,divisionId)**

CollectionTarget { academicYearId→, scope: INSTITUTION|CLASS|DIVISION, classId?, divisionId?,
                   periodType: MONTH|QUARTER|YEAR, periodKey: "2026-09", amount }   // **(institutionId,academicYearId,scope,classId,divisionId,periodType,periodKey)**
```

### I. Communication

```ts
ReminderTemplate { code, name, channel: WHATSAPP|SMS|EMAIL|IN_APP, type: UPCOMING|DUE_TODAY|OVERDUE|FOLLOW_UP|MANUAL|CUSTOM,
                   language, subject?, body, variables[], providerTemplateId?, approvalStatus: NA|PENDING|APPROVED|REJECTED, isActive, version }
ReminderRule     { name, type, offsetDays (−7,−1,0,+3,+7), repeatEveryDays?, maxRepeats?, sendTime: "HH:mm",
                   channels[], templateByChannel{}, targets{academicYearId?,classIds?,divisionIds?,kinds?,minPendingPaise?}, isActive }
ReminderCampaign { source: MANUAL|RULE, ruleId?, name, audienceFilter (snapshot), studentIds? (explicit, capped),
                   channels[], templateByChannel{}, scheduledFor?, status: DRAFT|SCHEDULED|RUNNING|COMPLETED|CANCELLED, counts{…} }
Reminder         { campaignId?, ruleId?, studentId→, guardianSnapshot{name,mobile?,email?}, receivableIds[]→, academicYearId→,
                   channel, type, templateId→, renderedMessage, pendingAtSend?, scheduledFor,
                   status: QUEUED|SENDING|SENT|DELIVERED|READ|FAILED|SKIPPED|CANCELLED, skipReason?: SETTLED|OPTED_OUT|NO_CONTACT|QUIET_HOURS|…,
                   failureReason?, providerMessageId?, attempts, sentAt?, deliveredAt?, sentBy: userId|"SYSTEM", dedupeKey }
// Reminder: **(institutionId,dedupeKey)** · (studentId,createdAt) · (status,scheduledFor) · (providerMessageId) · (campaignId,status) · (institutionId,sentAt)
Notification     { recipientUserId→, type, title, body, link?, readAt?, createdAt }   // (recipientUserId, readAt, createdAt)
```

### J. Identity, audit, bulk operations

```ts
User    { email, name, mobile?, passwordHash(argon2id), roleIds[]→, teacherId?→, status: INVITED|ACTIVE|INACTIVE|LOCKED,
          mustChangePassword, failedLoginCount, lockedUntil?, lastLoginAt?, tokenVersion, mfa?{enabled,secretEnc} }   // **(institutionId,email)**
Role    { key, name, description, permissions[] (keys from code registry), dataScope: ALL | OWN_DIVISIONS, isSystem, version }  // **(institutionId,key)**
Session { userId→, familyId, tokenHash, userAgent, ip, createdAt, lastUsedAt, expiresAt (TTL idx), revokedAt?, replacedBy? }   // (familyId) (userId,revokedAt)

AuditLog {                              // APPEND-ONLY, hash-chained (see §18)
  at, userId?→, userName, roleKeys[], action: "PAYMENT_REVERSED"…, entityType, entityId,
  studentId? (denormalized for Student 360), academicYearId?,
  before?, after? (field-level diff, sensitive fields redacted), reason?,
  ip, userAgent, requestId, correlationId?, prevHash, hash
}
// (entityType,entityId,at desc) · (studentId,at desc) · (userId,at desc) · (action,at desc) · (institutionId,at desc)

ImportBatch { type: STUDENTS|ENROLLMENTS|CLASSES|DIVISIONS|TEACHER_ASSIGNMENTS|OPENING_BALANCES|FEES|PAYMENTS, fileId→, checksum,
              status: UPLOADED|VALIDATING|VALIDATED|COMMITTING|COMMITTED|PARTIAL|FAILED|CANCELLED,
              mapping, summary{total,valid,invalid,duplicate,missing,warnings}, options{skipInvalid}, confirmedBy?, confirmedAt?, committedCounts{} }
ImportRow   { batchId→, rowNo, raw, normalized, status: VALID|INVALID|DUPLICATE|WARNING|COMMITTED|FAILED, errors[]{field,code,message}, createdEntityId? }  // **(batchId,rowNo)** (batchId,status)
IdempotencyKey { key, route, userId, requestHash, status: IN_PROGRESS|DONE, responseStatus?, responseBody?, createdAt }   // **(institutionId,userId,route,key)** · TTL 48 h
//   Generic replay store for admission/promotion/import-commit/etc. (payments additionally carry their own unique idempotencyKey as a DB-level backstop). Same key + different requestHash → 422 IDEMPOTENCY_KEY_REUSED.
ExportJob   { reportKey, format: PDF|XLSX|CSV, filters, requestedBy, status: QUEUED|RUNNING|DONE|FAILED|EXPIRED, fileId?, rowCount?, expiresAt }
```

**Collection count: 41** (incl. read models and bulk ops). Not a collection on purpose: *Permission* (code registry), *Installment* (a `kind` of Receivable), *Discount* (named `adjustments`).

---

## 3.4 Mutability matrix — what may change, and how

| Entity | May change in place | Everything else changes by… |
|---|---|---|
| Payment | `status` (POSTED→REVERSED), `reversalId`, `uniqueRefKey` unset (on reversal), non-financial `remarks` via `payment.editMeta` (audited) | Reverse + re-enter |
| PaymentAllocation, Receipt (snapshot), AuditLog, PaymentReversal (after completion) | **nothing** | Contra rows / new documents |
| Receipt | `status`→CANCELLED (with reversal), `printCount`, `lastPrintedAt`, `pdf` cache | — |
| Receivable | `paid/pending/adjusted/paymentStatus` (engine-only, guarded), `dueDate` (audited, appended to `dueDateHistory`) | **Restructure**: carve the pending part into new receivables; old one keeps what was paid |
| FeeStructureVersion (PUBLISHED) | `status`→SUPERSEDED | New version |
| FeeAssignment | `status` | New assignment superseding the old (BRC-C3) |
| OpeningBalance | `status`→REVERSED | Reverse + create new (BRC-D1) |
| Adjustment | `status` transitions | Reverse + create new |
| StudentEnrollment | `isCurrent`, `endedOn`, `endReason`, `status` | New row |
| TeacherAssignment | `effectiveTo`, `isCurrent`, `endReason` | New row |
| Student (master) | demographics, contact, status | Audited; class/division never edited here |
| Division/Class/Teacher/AcademicYear | attributes (audited, versioned) | Year-scoped divisions keep history |

The repository layer exposes **no generic `update`/`delete` for finance collections** — only named transitions (`markReversed`, `applyAllocationGuarded`, …). Mongo role for the API user has **insert-only** on `audit_logs`, `payment_allocations`, `receipts` (update denied) in production.

---

## 4. Entity Relationships

### 4.1 Diagram (ASCII ER)

```
Institution 1──* AcademicYear 1──* Division *──1 Class
                     │                │
                     │                ├──* TeacherAssignment *──1 Teacher ──0..1 User
                     │                │         (effective-dated, one current CLASS_TEACHER per division)
                     │                │
                     │                └──* StudentEnrollment *──1 Student *──* Parent (via guardians[])
                     │                         │   (one current per student-year)       │
                     │                         │                                        └─ *──1 StudentCategory
                     │                         ▼
                     ├──* FeeStructure(year,class,division?,category?) 1──* FeeStructureVersion (immutable, content-hashed)
                     │                                                      ▲
                     │                                                      │ snapshot reference
                     └──* FeeAssignment (student×year) ─────────────────────┘
                              │ generates
                              ▼
   OpeningBalance ──1:1──► Receivable  ◄── LateFeePolicy (kind=PENALTY, parent→Installment receivable)
   (kind=OPENING_BALANCE)   (kind=INSTALLMENT) ... components[{payable,adjusted,paid}]
                              ▲        ▲
        Adjustment ───────────┘        └──── PaymentAllocation *──1 Payment 1──1 Receipt
        (applications[])                      (signed ledger rows)    │ 0..1
                                                                     PaymentReversal
   StudentYearBalance  ◄─ recomputed from Receivables (read model)
   Reminder *──1 Student ; Reminder.receivableIds[] ──► Receivable ; Reminder *──1 ReminderCampaign/ReminderRule
   AuditLog ──► (entityType, entityId, studentId)    ImportBatch 1──* ImportRow    User *──* Role
```

### 4.2 Cardinalities & invariants (each one is a test)

| # | Invariant | Enforced by |
|---|---|---|
| I1 | A student has **≤ 1 current enrollment per academic year** | partial unique index |
| I2 | A student has **≤ 1 ACTIVE fee assignment per academic year** | partial unique index |
| I3 | A division has **≤ 1 current class teacher** | partial unique index + txn close/open |
| I4 | A (structure slot) = unique (year, class, division?, category?) | unique index |
| I5 | **≤ 1 ACTIVE opening balance per student-year**; creating it creates exactly 1 receivable, and **does not change `grossFee`** | unique index + engine test |
| I6 | A published fee version is immutable | repository (no update path) + tests |
| I7 | `receivable.pending = payable − adjusted − transferred − paid ≥ 0` | guarded `$inc` + `$expr` validator + nightly reconcile |
| I8 | `Σ allocations(payment) + unallocated = payment.amount` | engine + service test |
| I9 | `Σ allocations(receivable) = receivable.paid` | nightly reconciliation job (alerts on drift) |
| I10 | A payment is reversed **at most once**; reversal restores every touched receivable exactly | unique `payment_reversals.paymentId` + property test |
| I11 | Receipt number unique and never reused (gaps allowed); one receipt per payment | counter + unique indexes |
| I12 | Duplicate payment (same idempotency key / same unique reference) impossible | unique indexes |
| I13 | `student.current` equals the current-year `isCurrent` enrollment | enrollment service txn + rebuild job + test |
| I14 | Fee changes in year Y never alter documents of year Y−1 | version immutability + assignments snapshot; regression test |
