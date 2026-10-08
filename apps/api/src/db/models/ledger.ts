import { Schema } from 'mongoose';
import { COLLECTION_VALIDATORS } from '../validators';
import {
  bool,
  businessDate,
  defineModel,
  enumStr,
  mixed,
  oid,
  paise,
  str,
  tenant,
} from '../schema-helpers';

const component = new Schema(
  {
    componentId: { type: Schema.Types.ObjectId, ref: 'FeeComponent' },
    code: { type: String, required: true },
    name: { type: String, required: true },
    payable: paise(),
    adjusted: paise(),
    transferred: paise(),
    paid: paise(),
  },
  { _id: false },
);

/** ONE payable unit: installment · opening balance · penalty. `pending` is derived and guarded — never typed in. */
export const Receivable = defineModel({
  name: 'Receivable',
  collection: 'receivables',
  validator: COLLECTION_VALIDATORS.receivables as Record<string, unknown>,
  fields: {
    ...tenant,
    studentId: oid('Student'),
    academicYearId: oid('AcademicYear'),
    classId: oid('Class', false),
    divisionId: oid('Division', false),
    kind: enumStr(['INSTALLMENT', 'OPENING_BALANCE', 'PENALTY', 'ADHOC']),
    sourceType: enumStr(['FEE_ASSIGNMENT', 'OPENING_BALANCE', 'LATE_FEE', 'MANUAL']),
    sourceId: str(),
    installmentNo: { type: Number, min: 1 },
    label: str(),
    dueDate: businessDate(),
    originalDueDate: businessDate(),
    dueDateHistory: { type: [mixed()], default: [] },
    parentReceivableId: oid('Receivable', false),
    periodKey: str(false),
    components: {
      type: [component],
      validate: {
        validator: (c: unknown[]) => c.length >= 1,
        message: 'a receivable needs at least one component',
      },
    },
    payable: paise(),
    adjusted: paise(),
    transferred: paise(),
    paid: paise(),
    pending: paise(),
    paymentStatus: enumStr(
      ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED', 'TRANSFERRED', 'VOID'],
      true,
      'UNPAID',
    ),
    hasPendingAdjustment: bool(false),
    restructuredFromId: oid('Receivable', false),
    restructureSeq: { type: Number },
    dedupeKey: str(),
    voidReason: str(false),
    version: { type: Number, required: true, default: 0, min: 0 },
  },
  indexes: [
    // no duplicate installment / opening balance / penalty — ever
    [{ institutionId: 1, dedupeKey: 1 }, { unique: true }],
    [{ studentId: 1, academicYearId: 1, paymentStatus: 1, dueDate: 1 }],
    [{ institutionId: 1, academicYearId: 1, classId: 1, divisionId: 1, paymentStatus: 1 }],
    // overdue / due-soon / reminder scans only look at receivables that still owe something
    [
      { institutionId: 1, dueDate: 1 },
      { partialFilterExpression: { pending: { $gt: 0 } }, name: 'pending_by_due_date' },
    ],
    [{ institutionId: 1, kind: 1, academicYearId: 1 }],
    [{ parentReceivableId: 1 }, { sparse: true }],
  ],
});

export const OpeningBalance = defineModel({
  name: 'OpeningBalance',
  collection: 'opening_balances',
  validator: COLLECTION_VALIDATORS.opening_balances as Record<string, unknown>,
  fields: {
    ...tenant,
    studentId: oid('Student'),
    academicYearId: oid('AcademicYear'),
    amount: paise(),
    effectiveDate: businessDate(),
    dueDate: businessDate(),
    source: enumStr(['MIGRATION', 'MANUAL', 'ADMISSION', 'CARRY_FORWARD']),
    reason: str(),
    remarks: str(false),
    importRef: { batchId: oid('ImportBatch', false), rowNo: Number },
    carryForwardFrom: {
      type: [
        {
          receivableId: Schema.Types.ObjectId,
          academicYearId: Schema.Types.ObjectId,
          amount: paise(),
        },
      ],
      default: undefined,
    },
    receivableId: oid('Receivable'),
    status: enumStr(['ACTIVE', 'REVERSED'], true, 'ACTIVE'),
    reversal: { at: Date, by: Schema.Types.ObjectId, reason: String },
    createdBy: oid('User', false),
  },
  indexes: [
    // no duplicate opening balance for a student-year
    [
      { studentId: 1, academicYearId: 1 },
      {
        unique: true,
        partialFilterExpression: { status: 'ACTIVE' },
        name: 'one_active_opening_balance',
      },
    ],
    [{ institutionId: 1, academicYearId: 1, source: 1 }],
    [{ 'importRef.batchId': 1 }, { sparse: true }],
  ],
});

export const Adjustment = defineModel({
  name: 'Adjustment',
  collection: 'adjustments',
  fields: {
    ...tenant,
    studentId: oid('Student'),
    academicYearId: oid('AcademicYear'),
    type: enumStr(['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER', 'PENALTY_WAIVER', 'OTHER']),
    calc: mixed(),
    amount: paise(),
    applications: {
      type: [{ receivableId: Schema.Types.ObjectId, componentCode: String, amount: paise() }],
      default: [],
    },
    distribution: enumStr(['PROPORTIONAL', 'EARLIEST_FIRST', 'LATEST_FIRST', 'SPECIFIC']),
    reason: str(),
    remarks: str(false),
    effectiveDate: businessDate(),
    status: enumStr(
      ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERSED'],
      true,
      'PENDING_APPROVAL',
    ),
    requestedBy: oid('User'),
    requestedAt: { type: Date, default: Date.now },
    approvedBy: oid('User', false),
    approvedAt: { type: Date },
    rejectedReason: str(false),
    reversal: { at: Date, by: Schema.Types.ObjectId, reason: String },
  },
  indexes: [
    [{ studentId: 1, academicYearId: 1, status: 1 }],
    [{ status: 1, requestedAt: 1 }],
    [{ institutionId: 1, type: 1, approvedAt: 1 }],
  ],
});

/** IMMUTABLE fact; only `status`/`reversalId`/`uniqueRefKey` transition on reversal */
export const Payment = defineModel({
  name: 'Payment',
  collection: 'payments',
  validator: COLLECTION_VALIDATORS.payments as Record<string, unknown>,
  fields: {
    ...tenant,
    paymentNo: str(),
    studentId: oid('Student'),
    amount: paise(),
    allocatedAmount: paise(),
    unallocatedAmount: paise(),
    method: str(),
    reference: {
      type: { type: String },
      number: String,
      bank: String,
      chequeDate: String,
      note: String,
    },
    uniqueRefKey: { type: String },
    paymentDate: businessDate(),
    receivedAt: { type: Date, required: true },
    collectedBy: oid('User'),
    source: enumStr(['COUNTER', 'HISTORICAL', 'IMPORT', 'ADVANCE_ADJUSTMENT'], true, 'COUNTER'),
    allocationMode: enumStr(['AUTO', 'MANUAL'], true, 'AUTO'),
    allocationStrategy: enumStr(['OLDEST_DUE_FIRST', 'MANUAL']),
    remarks: str(false),
    idempotencyKey: str(),
    requestHash: str(),
    status: enumStr(['POSTED', 'REVERSED'], true, 'POSTED'),
    receiptId: oid('Receipt', false),
    receiptNo: str(),
    reversalId: oid('PaymentReversal', false),
  },
  indexes: [
    [{ institutionId: 1, paymentNo: 1 }, { unique: true }],
    // duplicate payment (double click / retry) is impossible
    [{ institutionId: 1, idempotencyKey: 1 }, { unique: true }],
    // duplicate transaction reference (UPI / bank / card) is impossible; unset on reversal → corrected re-entry allowed
    [
      { institutionId: 1, uniqueRefKey: 1 },
      {
        unique: true,
        partialFilterExpression: { uniqueRefKey: { $type: 'string' } },
        name: 'unique_transaction_reference',
      },
    ],
    [{ studentId: 1, paymentDate: -1 }],
    [{ institutionId: 1, paymentDate: 1, collectedBy: 1 }],
    [{ institutionId: 1, paymentDate: 1, method: 1 }],
    [{ receiptId: 1 }, { sparse: true }],
  ],
});

/** APPEND-ONLY ledger rows; reversals are negative rows */
export const PaymentAllocation = defineModel({
  name: 'PaymentAllocation',
  collection: 'payment_allocations',
  validator: COLLECTION_VALIDATORS.payment_allocations as Record<string, unknown>,
  timestamps: false,
  fields: {
    ...tenant,
    paymentId: oid('Payment'),
    studentId: oid('Student'),
    receivableId: oid('Receivable'),
    academicYearId: oid('AcademicYear'),
    classId: oid('Class', false),
    divisionId: oid('Division', false),
    kind: enumStr(['ALLOCATION', 'REVERSAL']),
    amount: paise({ min: null }),
    componentSplit: {
      type: [{ componentCode: { type: String, required: true }, amount: paise({ min: null }) }],
      default: [],
    },
    reversesAllocationId: oid('PaymentAllocation', false),
    postingDate: businessDate(),
    createdAt: { type: Date, default: Date.now, immutable: true },
    createdBy: oid('User', false),
  },
  indexes: [
    [{ paymentId: 1 }],
    [{ receivableId: 1 }],
    [{ institutionId: 1, postingDate: 1, classId: 1, divisionId: 1 }],
    [{ studentId: 1, postingDate: 1 }],
    // a reversal row can reverse a given allocation only once
    [
      { reversesAllocationId: 1 },
      {
        unique: true,
        partialFilterExpression: { reversesAllocationId: { $type: 'objectId' } },
        name: 'one_reversal_per_allocation',
      },
    ],
  ],
});

export const PaymentReversal = defineModel({
  name: 'PaymentReversal',
  collection: 'payment_reversals',
  fields: {
    ...tenant,
    paymentId: oid('Payment'),
    reasonCode: str(false),
    reasonText: str(),
    requestedBy: oid('User'),
    requestedAt: { type: Date, default: Date.now },
    originalPaymentDate: businessDate(),
    originalAmount: paise(),
    reversalDate: businessDate(),
    reversedAmount: paise(),
    approvalRequired: bool(false),
    approvedBy: oid('User', false),
    approvedAt: { type: Date },
    rejectedBy: oid('User', false),
    rejectedReason: str(false),
    authorizedBy: oid('User'),
    status: enumStr(['PENDING_APPROVAL', 'COMPLETED', 'REJECTED']),
    completedAt: { type: Date },
    refund: mixed(),
    idempotencyKey: str(false),
  },
  // a payment can be reversed at most once
  indexes: [[{ paymentId: 1 }, { unique: true }], [{ status: 1, requestedAt: 1 }]],
});

export const Receipt = defineModel({
  name: 'Receipt',
  collection: 'receipts',
  fields: {
    ...tenant,
    receiptNo: str(),
    paymentId: oid('Payment'),
    studentId: oid('Student'),
    academicYearId: oid('AcademicYear', false),
    status: enumStr(['ISSUED', 'CANCELLED'], true, 'ISSUED'),
    issuedAt: { type: Date, required: true },
    issuedBy: oid('User', false),
    snapshot: mixed(),
    balances: {
      previousBalance: paise({ min: null }),
      paidNow: paise(),
      remainingBalance: paise({ min: null }),
    },
    pdf: mixed(),
    printCount: { type: Number, default: 0 },
    lastPrintedAt: { type: Date },
    cancellation: { at: Date, by: Schema.Types.ObjectId, reason: String },
  },
  indexes: [
    // receipt numbers are unique and never reused (gaps allowed); users can never type one
    [{ institutionId: 1, receiptNo: 1 }, { unique: true }],
    [{ paymentId: 1 }, { unique: true }],
    [{ studentId: 1, issuedAt: 1 }],
  ],
});

/** REBUILDABLE read model, recomputed from receivables inside the same transaction — never the source of truth */
export const StudentYearBalance = defineModel({
  name: 'StudentYearBalance',
  collection: 'student_year_balances',
  fields: {
    ...tenant,
    studentId: oid('Student'),
    academicYearId: oid('AcademicYear'),
    classId: oid('Class', false),
    divisionId: oid('Division', false),
    grossFee: paise(),
    openingBalance: paise(),
    penalties: paise(),
    adjustments: paise(),
    transferred: paise(),
    netReceivable: paise(),
    paid: paise(),
    pending: paise(),
    creditBalance: paise(),
    earliestPendingDueDate: businessDate({ required: false }),
    paymentState: enumStr(['UNPAID', 'PARTIAL', 'PAID', 'NONE']),
    lastPaymentDate: businessDate({ required: false }),
    version: { type: Number, default: 0 },
  },
  indexes: [
    [{ studentId: 1, academicYearId: 1 }, { unique: true }],
    [{ institutionId: 1, academicYearId: 1, classId: 1, divisionId: 1, pending: 1 }],
    [
      { institutionId: 1, academicYearId: 1, earliestPendingDueDate: 1 },
      { partialFilterExpression: { pending: { $gt: 0 } }, name: 'overdue_students' },
    ],
  ],
});

export const DailySnapshot = defineModel({
  name: 'DailySnapshot',
  collection: 'daily_snapshots',
  fields: {
    ...tenant,
    date: businessDate(),
    academicYearId: oid('AcademicYear'),
    classId: oid('Class'),
    divisionId: oid('Division'),
    students: { type: Number, default: 0 },
    grossFee: paise(),
    openingBalance: paise(),
    penalties: paise(),
    adjustments: paise(),
    netReceivable: paise(),
    collectedToDate: paise(),
    pending: paise(),
    overdue: paise(),
    aging: mixed(),
  },
  indexes: [[{ institutionId: 1, date: 1, academicYearId: 1, divisionId: 1 }, { unique: true }]],
});

export const CollectionTarget = defineModel({
  name: 'CollectionTarget',
  collection: 'collection_targets',
  fields: {
    ...tenant,
    academicYearId: oid('AcademicYear'),
    scope: enumStr(['INSTITUTION', 'CLASS', 'DIVISION']),
    classId: { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    divisionId: { type: Schema.Types.ObjectId, ref: 'Division', default: null },
    periodType: enumStr(['MONTH', 'QUARTER', 'YEAR']),
    periodKey: str(),
    amount: paise(),
  },
  indexes: [
    [
      {
        institutionId: 1,
        academicYearId: 1,
        scope: 1,
        classId: 1,
        divisionId: 1,
        periodType: 1,
        periodKey: 1,
      },
      { unique: true },
    ],
  ],
});
