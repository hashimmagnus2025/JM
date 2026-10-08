import { isAfter, isBefore, mulDivRound, type BusinessDate, type Paise } from '@sfm/shared';

/**
 * Annual student system charge (decision BRC-K1).
 *
 * This is a COMMERCIAL rule. It is deliberately isolated from the fee engine: nothing here imports
 * `domain/finance`, and nothing in the fee engine knows about the ₹120 charge. The rate and the
 * billing point are settings (`billing.ratePerStudentPaise`, `billing.point`).
 */

export type BillingStudentStatus = 'ACTIVE' | 'INACTIVE' | 'TRANSFERRED' | 'WITHDRAWN' | 'PASSED_OUT' | 'ARCHIVED';

export interface BillingStudent {
  id: string;
  status: BillingStudentStatus;
}

export interface BillingEnrollment {
  studentId: string;
  academicYearId: string;
  status: 'ACTIVE' | 'ENDED' | 'CANCELLED';
  enrolledOn: BusinessDate;
  endedOn: BusinessDate | null;
}

/** an "active student" is a student with status ACTIVE (not withdrawn/inactive/passed-out/transferred/archived) … */
export const isBillableStudentStatus = (s: BillingStudentStatus): boolean => s === 'ACTIVE';

export interface ActiveStudentCount {
  count: number;
  /** unique, sorted — useful for the billing statement */
  studentIds: string[];
}

/** … who has an enrollment in the billing year that is in force on the billing date. Unique students: duplicates collapse. */
export function countActiveStudents(input: {
  students: readonly BillingStudent[];
  enrollments: readonly BillingEnrollment[];
  academicYearId: string;
  asOf: BusinessDate;
}): ActiveStudentCount {
  const billable = new Set(input.students.filter((s) => isBillableStudentStatus(s.status)).map((s) => s.id));
  const active = new Set<string>();
  for (const e of input.enrollments) {
    if (e.academicYearId !== input.academicYearId || e.status === 'CANCELLED') continue;
    if (isAfter(e.enrolledOn, input.asOf)) continue;
    if (e.endedOn !== null && isBefore(e.endedOn, input.asOf)) continue;
    if (billable.has(e.studentId)) active.add(e.studentId);
  }
  const studentIds = [...active].sort();
  return { count: studentIds.length, studentIds };
}

/** count × rate, overflow-safe. Example (SOW): 100 students × ₹120 = ₹12,000. */
export function computeAnnualStudentCharge(input: { activeCount: number; ratePerStudentPaise: Paise }): Paise {
  if (!Number.isInteger(input.activeCount) || input.activeCount < 0) throw new RangeError('active count must be a non-negative integer');
  if (!Number.isSafeInteger(input.ratePerStudentPaise) || input.ratePerStudentPaise < 0) throw new RangeError('rate must be a non-negative whole paise amount');
  return mulDivRound(input.activeCount, input.ratePerStudentPaise, 1);
}

export type BillingPoint = { kind: 'ACADEMIC_YEAR_START' } | { kind: 'FIXED_DATE'; date: BusinessDate } | { kind: 'ON_DEMAND' };

/** the date on which the active-student count is taken (CL-13 default: the academic year's start date) */
export function resolveBillingDate(point: BillingPoint, year: { startDate: BusinessDate }, today: BusinessDate): BusinessDate {
  switch (point.kind) {
    case 'ACADEMIC_YEAR_START':
      return year.startDate;
    case 'FIXED_DATE':
      return point.date;
    case 'ON_DEMAND':
      return today;
  }
}
