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

/**
 * A student's link to a Parent. The relation (father / mother / guardian) belongs to the LINK, not to
 * the parent: the same person can be the father of one student and the guardian of another.
 */
const guardianLink = new Schema(
  {
    parentId: { type: Schema.Types.ObjectId, ref: 'Parent', required: true },
    relation: { type: String, required: true, trim: true },
    isPrimary: { type: Boolean, default: false },
    isFeeContact: { type: Boolean, default: false },
  },
  { _id: false },
);

/**
 * One document per real person, shared by all their children (siblings). Changing a mobile number or
 * email happens in ONE place. Also the future login identity of the parent portal (SOW §52).
 */
export const Parent = defineModel({
  name: 'Parent',
  collection: 'parents',
  fields: {
    ...tenant,
    fullName: str(),
    nameSearch: str(false),
    /** normalized: last 10 digits; unique per institution → "this parent already exists" at admission */
    mobile: str(true, { match: /^\d{10}$/ }),
    altMobile: str(false, { match: /^\d{10}$/ }),
    email: str(false, { lowercase: true }),
    occupation: str(false),
    address: {
      line1: str(false),
      line2: str(false),
      city: str(false),
      state: str(false),
      pincode: str(false),
    },
    status: enumStr(['ACTIVE', 'INACTIVE'], true, 'ACTIVE'),
    /** reserved for the parent portal (not in release 1) */
    userId: oid('User', false),
    version: { type: Number, default: 0 },
    createdBy: oid('User', false),
  },
  indexes: [
    [{ institutionId: 1, mobile: 1 }, { unique: true }],
    [{ institutionId: 1, status: 1, nameSearch: 1 }],
    [{ institutionId: 1, altMobile: 1 }, { sparse: true }],
    [{ institutionId: 1, email: 1 }, { sparse: true }],
  ],
});

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
      type: [guardianLink],
      validate: [
        { validator: (g: unknown[]) => g.length >= 1, message: 'at least one parent is required' },
        {
          validator: (g: { isPrimary?: boolean }[]) => g.filter((x) => x.isPrimary).length === 1,
          message: 'exactly one primary parent is required',
        },
      ],
    },
    /** flat copy of guardians[].parentId for family queries (siblings, family-wise outstanding) */
    parentIds: { type: [Schema.Types.ObjectId], default: [] },
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
    [{ institutionId: 1, parentIds: 1 }],
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
