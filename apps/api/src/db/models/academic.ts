import { bool, businessDate, defineModel, enumStr, oid, str, tenant } from '../schema-helpers';

export const AcademicYear = defineModel({
  name: 'AcademicYear',
  collection: 'academic_years',
  fields: {
    ...tenant,
    label: str(true, { match: /^\d{4}-\d{2}$/ }),
    startDate: businessDate(),
    endDate: businessDate(),
    status: enumStr(['PLANNED', 'ACTIVE', 'CLOSED'], true, 'PLANNED'),
    isCurrent: bool(false),
    closedAt: { type: Date },
    closedBy: oid('User', false),
  },
  indexes: [
    [{ institutionId: 1, label: 1 }, { unique: true }],
    // exactly ONE current academic year per institution
    [
      { institutionId: 1 },
      { unique: true, partialFilterExpression: { isCurrent: true }, name: 'one_current_year' },
    ],
    [{ institutionId: 1, startDate: 1 }],
  ],
});

export const Class = defineModel({
  name: 'Class',
  collection: 'classes',
  fields: {
    ...tenant,
    code: str(),
    name: str(),
    sequence: { type: Number, required: true, min: 0 },
    isActive: bool(true),
    isFinal: bool(false),
  },
  indexes: [
    [{ institutionId: 1, code: 1 }, { unique: true }],
    [{ institutionId: 1, sequence: 1 }, { unique: true }],
  ],
});

/** year-scoped division: "Class 5-A in 2025-26" is a permanent historical fact */
export const Division = defineModel({
  name: 'Division',
  collection: 'divisions',
  fields: {
    ...tenant,
    academicYearId: oid('AcademicYear'),
    classId: oid('Class'),
    name: str(),
    capacity: { type: Number, min: 0 },
    isActive: bool(true),
  },
  indexes: [
    [{ academicYearId: 1, classId: 1, name: 1 }, { unique: true }],
    [{ academicYearId: 1, classId: 1, isActive: 1 }],
  ],
});

export const StudentCategory = defineModel({
  name: 'StudentCategory',
  collection: 'student_categories',
  fields: {
    ...tenant,
    code: str(),
    name: str(),
    isActive: bool(true),
    sequence: { type: Number, default: 0 },
  },
  indexes: [[{ institutionId: 1, code: 1 }, { unique: true }]],
});

export const Teacher = defineModel({
  name: 'Teacher',
  collection: 'teachers',
  fields: {
    ...tenant,
    teacherCode: str(),
    staffId: str(),
    fullName: str(),
    nameSearch: str(false),
    mobile: str(),
    email: str(false),
    gender: enumStr(['MALE', 'FEMALE', 'OTHER'], false),
    qualification: str(false),
    joiningDate: businessDate(),
    status: enumStr(['ACTIVE', 'INACTIVE', 'LEFT'], true, 'ACTIVE'),
    leavingDate: businessDate({ required: false }),
    remarks: str(false),
    userId: oid('User', false),
  },
  indexes: [
    [{ institutionId: 1, teacherCode: 1 }, { unique: true }],
    [{ institutionId: 1, staffId: 1 }, { unique: true }],
    [{ institutionId: 1, status: 1, nameSearch: 1 }],
    [{ institutionId: 1, mobile: 1 }],
  ],
});

/** effective-dated; never overwritten (decision #13) */
export const TeacherAssignment = defineModel({
  name: 'TeacherAssignment',
  collection: 'teacher_assignments',
  fields: {
    ...tenant,
    academicYearId: oid('AcademicYear'),
    classId: oid('Class'),
    divisionId: oid('Division'),
    teacherId: oid('Teacher'),
    role: enumStr(['CLASS_TEACHER'], true, 'CLASS_TEACHER'),
    effectiveFrom: businessDate(),
    effectiveTo: businessDate({ required: false }),
    isCurrent: bool(true),
    endReason: enumStr(['CHANGED', 'LEFT_INSTITUTION', 'CORRECTION', 'YEAR_END'], false),
    replacesAssignmentId: oid('TeacherAssignment', false),
    assignedBy: oid('User', false),
    reason: str(false),
  },
  indexes: [
    // ONE current class teacher per division (BRC-B6); a teacher may still hold several divisions
    [
      { divisionId: 1, role: 1 },
      {
        unique: true,
        partialFilterExpression: { isCurrent: true },
        name: 'one_current_teacher_per_division',
      },
    ],
    [{ teacherId: 1, academicYearId: 1, isCurrent: 1 }],
    [{ academicYearId: 1, classId: 1, divisionId: 1, effectiveFrom: 1 }],
    [{ teacherId: 1, effectiveFrom: 1 }],
  ],
});
