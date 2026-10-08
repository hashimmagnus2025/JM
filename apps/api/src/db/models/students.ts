import { Schema } from 'mongoose';
import {
  bool,
  businessDate,
  defineModel,
  enumStr,
  mixed,
  oid,
  str,
  tenant,
} from '../schema-helpers';

const guardian = new Schema(
  {
    relation: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    altMobile: String,
    email: String,
    occupation: String,
    isPrimary: { type: Boolean, default: false },
    isFeeContact: { type: Boolean, default: false },
  },
  { _id: false },
);

export const Student = defineModel({
  name: 'Student',
  collection: 'students',
  fields: {
    ...tenant,
    studentId: str(),
    admissionNo: str(),
    firstName: str(),
    middleName: str(false),
    lastName: str(false),
    fullName: str(),
    searchTokens: { type: [String], default: [] },
    dob: businessDate(),
    gender: enumStr(['MALE', 'FEMALE', 'OTHER']),
    categoryId: oid('StudentCategory'),
    guardians: {
      type: [guardian],
      validate: {
        validator: (g: unknown[]) => g.length >= 1,
        message: 'at least one guardian is required',
      },
    },
    mobileSearch: { type: [String], default: [] },
    email: str(false),
    address: {
      line1: str(false),
      line2: str(false),
      city: str(false),
      state: str(false),
      pincode: str(false),
    },
    admissionDate: businessDate(),
    photoFileId: oid('File', false),
    status: enumStr(
      ['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'WITHDRAWN', 'PASSED_OUT', 'ARCHIVED'],
      true,
      'ACTIVE',
    ),
    statusReason: str(false),
    statusChangedAt: { type: Date },
    /** PROJECTION of the current enrollment (rebuildable) — enrollments are the academic truth */
    current: {
      enrollmentId: oid('StudentEnrollment', false),
      academicYearId: oid('AcademicYear', false),
      classId: oid('Class', false),
      divisionId: oid('Division', false),
    },
    customFields: mixed(),
    version: { type: Number, default: 0 },
    createdBy: oid('User', false),
  },
  indexes: [
    [{ institutionId: 1, studentId: 1 }, { unique: true }],
    [{ institutionId: 1, admissionNo: 1 }, { unique: true }],
    [
      {
        institutionId: 1,
        status: 1,
        'current.academicYearId': 1,
        'current.classId': 1,
        'current.divisionId': 1,
      },
    ],
    [{ institutionId: 1, searchTokens: 1 }],
    [{ institutionId: 1, mobileSearch: 1 }],
    [{ institutionId: 1, dob: 1, fullName: 1 }],
  ],
});

/** academic truth; history is never overwritten (decision #12) */
export const StudentEnrollment = defineModel({
  name: 'StudentEnrollment',
  collection: 'student_enrollments',
  fields: {
    ...tenant,
    studentId: oid('Student'),
    academicYearId: oid('AcademicYear'),
    classId: oid('Class'),
    divisionId: oid('Division'),
    rollNo: str(false),
    type: enumStr(['NEW_ADMISSION', 'PROMOTION', 'REPEAT', 'READMISSION', 'MIGRATION']),
    status: enumStr(['ACTIVE', 'ENDED', 'CANCELLED'], true, 'ACTIVE'),
    endReason: enumStr(
      [
        'PROMOTED',
        'REPEATED',
        'PASSED_OUT',
        'TRANSFERRED_OUT',
        'WITHDRAWN',
        'DIVISION_CHANGE',
        'CORRECTION',
      ],
      false,
    ),
    isCurrent: bool(true),
    categoryId: oid('StudentCategory'),
    enrolledOn: businessDate(),
    endedOn: businessDate({ required: false }),
    previousEnrollmentId: oid('StudentEnrollment', false),
    promotionBatchId: oid('PromotionBatch', false),
  },
  indexes: [
    // no duplicate enrollment: one current row per student per academic year
    [
      { studentId: 1, academicYearId: 1 },
      {
        unique: true,
        partialFilterExpression: { isCurrent: true },
        name: 'one_current_enrollment_per_year',
      },
    ],
    [{ institutionId: 1, academicYearId: 1, divisionId: 1, isCurrent: 1 }],
    [{ studentId: 1, academicYearId: 1, enrolledOn: 1 }],
    [{ promotionBatchId: 1 }, { sparse: true }],
  ],
});

export const PromotionBatch = defineModel({
  name: 'PromotionBatch',
  collection: 'promotion_batches',
  fields: {
    ...tenant,
    fromAcademicYearId: oid('AcademicYear'),
    toAcademicYearId: oid('AcademicYear'),
    scope: mixed(),
    rules: mixed(),
    decisions: { type: [mixed()], default: [] },
    status: enumStr(
      ['DRAFT', 'PREVIEWED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'CANCELLED'],
      true,
      'DRAFT',
    ),
    counts: mixed(),
    createdBy: oid('User', false),
    committedAt: { type: Date },
  },
  indexes: [[{ institutionId: 1, toAcademicYearId: 1, status: 1 }]],
});
