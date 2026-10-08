import { Schema } from 'mongoose';
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

export const FeeComponent = defineModel({
  name: 'FeeComponent',
  collection: 'fee_components',
  fields: {
    ...tenant,
    code: str(),
    name: str(),
    kind: enumStr([
      'TUITION',
      'ADMISSION',
      'EXAMINATION',
      'TRANSPORT',
      'ACTIVITY',
      'LIBRARY',
      'LABORATORY',
      'MISC',
      'CUSTOM',
      'OPENING_BALANCE',
      'LATE_FEE',
    ]),
    isSystem: bool(false),
    isOptionalByDefault: bool(false),
    isActive: bool(true),
    sequence: { type: Number, default: 0 },
  },
  indexes: [[{ institutionId: 1, code: 1 }, { unique: true }]],
});

export const FeeStructure = defineModel({
  name: 'FeeStructure',
  collection: 'fee_structures',
  fields: {
    ...tenant,
    academicYearId: oid('AcademicYear'),
    classId: oid('Class'),
    divisionId: { type: Schema.Types.ObjectId, ref: 'Division', default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'StudentCategory', default: null },
    name: str(),
    status: enumStr(['ACTIVE', 'ARCHIVED'], true, 'ACTIVE'),
    currentVersionId: oid('FeeStructureVersion', false),
    latestVersionNo: { type: Number, default: 0 },
  },
  // nulls compare equal → one structure per (year, class, division?, category?) slot
  indexes: [
    [
      { institutionId: 1, academicYearId: 1, classId: 1, divisionId: 1, categoryId: 1 },
      { unique: true },
    ],
  ],
});

const feeLine = new Schema(
  {
    componentId: { type: Schema.Types.ObjectId, ref: 'FeeComponent', required: true },
    code: String,
    name: String,
    amount: paise(),
    isOptional: Boolean,
    sequence: Number,
  },
  { _id: false },
);

/** IMMUTABLE once PUBLISHED (decision #11): enforced by the repository (no update path) + status-guarded writes */
export const FeeStructureVersion = defineModel({
  name: 'FeeStructureVersion',
  collection: 'fee_structure_versions',
  fields: {
    ...tenant,
    structureId: oid('FeeStructure'),
    academicYearId: oid('AcademicYear'),
    versionNo: { type: Number, required: true, min: 1 },
    status: enumStr(['DRAFT', 'PUBLISHED', 'SUPERSEDED'], true, 'DRAFT'),
    effectiveFrom: businessDate(),
    changeReason: str(false),
    publishedAt: { type: Date },
    publishedBy: oid('User', false),
    supersededAt: { type: Date },
    contentHash: str(false),
    lines: { type: [feeLine], default: [] },
    plans: { type: [mixed()], default: [] },
    lateFeePolicyId: oid('LateFeePolicy', false),
  },
  indexes: [[{ structureId: 1, versionNo: 1 }, { unique: true }], [{ structureId: 1, status: 1 }]],
});

export const FeeAssignment = defineModel({
  name: 'FeeAssignment',
  collection: 'fee_assignments',
  fields: {
    ...tenant,
    studentId: oid('Student'),
    academicYearId: oid('AcademicYear'),
    enrollmentId: oid('StudentEnrollment'),
    classId: oid('Class'),
    divisionId: oid('Division'),
    categoryId: oid('StudentCategory'),
    structureId: oid('FeeStructure'),
    structureVersionId: oid('FeeStructureVersion'),
    planCode: str(false),
    planMode: enumStr(['STANDARD', 'FULL', 'CUSTOM'], true, 'STANDARD'),
    lines: { type: [mixed()], default: [] },
    grossAmount: paise(),
    status: enumStr(['ACTIVE', 'CANCELLED', 'VOID'], true, 'ACTIVE'),
    supersedesAssignmentId: oid('FeeAssignment', false),
    source: enumStr(['ADMISSION', 'PROMOTION', 'IMPORT', 'MANUAL', 'REASSIGNMENT']),
    assignedAt: { type: Date, default: Date.now },
    assignedBy: oid('User', false),
    cancelReason: str(false),
    version: { type: Number, default: 0 },
  },
  indexes: [
    // no duplicate fee assignment: one ACTIVE assignment per student per academic year
    [
      { studentId: 1, academicYearId: 1 },
      {
        unique: true,
        partialFilterExpression: { status: 'ACTIVE' },
        name: 'one_active_assignment_per_year',
      },
    ],
    [{ structureVersionId: 1 }],
    [{ academicYearId: 1, classId: 1, divisionId: 1, status: 1 }],
  ],
});

export const LateFeePolicy = defineModel({
  name: 'LateFeePolicy',
  collection: 'late_fee_policies',
  fields: {
    ...tenant,
    name: str(),
    mode: enumStr(['FIXED', 'PER_DAY', 'PERCENT']),
    valuePaise: paise({ required: false }),
    valueBp: { type: Number, min: 1, max: 10_000 },
    graceDays: { type: Number, default: 0, min: 0, max: 3650 },
    capPaise: paise({ required: false }),
    appliesToKinds: { type: [String], default: ['INSTALLMENT'] },
    applyToOpeningBalance: bool(false),
    installmentOverrides: mixed(),
    scope: mixed(),
    effectiveFrom: businessDate(),
    effectiveTo: businessDate({ required: false }),
    isActive: bool(true),
    version: { type: Number, default: 1 },
  },
  indexes: [[{ institutionId: 1, isActive: 1, effectiveFrom: 1 }]],
});
