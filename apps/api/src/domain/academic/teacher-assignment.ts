import {
  addDays,
  assertBusinessDate,
  isAfter,
  isBefore,
  maxDate,
  minDate,
  type BusinessDate,
} from '@sfm/shared';
import { AcademicError } from './errors';

/**
 * Class-teacher assignment rules (decision BRC-B6).
 *  - one ACTIVE class teacher per division-year at any time
 *  - a teacher MAY hold several divisions (setting `teacher.allowMultipleDivisions`, default true)
 *  - changing a teacher closes the old row and creates a new one — history is never overwritten
 */

export type AssignmentRole = 'CLASS_TEACHER';
export type AssignmentEndReason = 'CHANGED' | 'LEFT_INSTITUTION' | 'CORRECTION' | 'YEAR_END';

export interface TeacherAssignment {
  id: string;
  academicYearId: string;
  classId: string;
  divisionId: string;
  teacherId: string;
  role: AssignmentRole;
  effectiveFrom: BusinessDate;
  /** null = open ended */
  effectiveTo: BusinessDate | null;
  isCurrent: boolean;
  endReason?: AssignmentEndReason;
  replacesAssignmentId?: string;
  reason?: string;
}

export interface AcademicYearRange {
  id: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
}

export interface DivisionRef {
  id: string;
  classId: string;
  academicYearId: string;
}

export interface TeacherRef {
  id: string;
  status: 'ACTIVE' | 'INACTIVE' | 'LEFT';
}

export interface AssignmentSettings {
  allowMultipleDivisions: boolean;
}

export const DEFAULT_ASSIGNMENT_SETTINGS: AssignmentSettings = { allowMultipleDivisions: true };

function assertWithinYear(date: BusinessDate, year: AcademicYearRange): void {
  assertBusinessDate(date, 'effective date');
  if (isBefore(date, year.startDate) || isAfter(date, year.endDate)) {
    throw new AcademicError(
      'EFFECTIVE_DATE_OUTSIDE_YEAR',
      'The effective date must fall inside the academic year.',
      {
        date,
        start: year.startDate,
        end: year.endDate,
      },
    );
  }
}

function assertTeacherCanTake(
  teacher: TeacherRef,
  year: AcademicYearRange,
  existing: readonly TeacherAssignment[],
  settings: AssignmentSettings,
  ignoreAssignmentId?: string,
): void {
  if (teacher.status !== 'ACTIVE') {
    throw new AcademicError('TEACHER_NOT_ACTIVE', 'Only an active teacher can be assigned.', {
      teacherId: teacher.id,
    });
  }
  if (!settings.allowMultipleDivisions) {
    const clash = existing.find(
      (a) =>
        a.isCurrent &&
        a.academicYearId === year.id &&
        a.teacherId === teacher.id &&
        a.id !== ignoreAssignmentId,
    );
    if (clash) {
      throw new AcademicError(
        'TEACHER_ALREADY_ASSIGNED',
        'This teacher already has a division in this academic year.',
        {
          divisionId: clash.divisionId,
        },
      );
    }
  }
}

export interface AssignInput {
  division: DivisionRef;
  teacher: TeacherRef;
  year: AcademicYearRange;
  effectiveFrom: BusinessDate;
  existing: readonly TeacherAssignment[];
  settings?: AssignmentSettings;
  newId: string;
}

export function planAssign(input: AssignInput): { create: TeacherAssignment } {
  const settings = input.settings ?? DEFAULT_ASSIGNMENT_SETTINGS;
  if (input.division.academicYearId !== input.year.id) {
    throw new AcademicError(
      'ASSIGNMENT_YEAR_MISMATCH',
      'The division belongs to a different academic year.',
    );
  }
  assertWithinYear(input.effectiveFrom, input.year);
  const taken = input.existing.find(
    (a) => a.isCurrent && a.divisionId === input.division.id && a.role === 'CLASS_TEACHER',
  );
  if (taken) {
    throw new AcademicError(
      'DIVISION_ALREADY_HAS_TEACHER',
      'This division already has a class teacher. Use "Change teacher" instead.',
      { currentAssignmentId: taken.id },
    );
  }
  assertTeacherCanTake(input.teacher, input.year, input.existing, settings);
  return {
    create: {
      id: input.newId,
      academicYearId: input.year.id,
      classId: input.division.classId,
      divisionId: input.division.id,
      teacherId: input.teacher.id,
      role: 'CLASS_TEACHER',
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      isCurrent: true,
    },
  };
}

export interface ChangeInput {
  current: TeacherAssignment;
  newTeacher: TeacherRef;
  year: AcademicYearRange;
  effectiveFrom: BusinessDate;
  reason: string;
  existing: readonly TeacherAssignment[];
  settings?: AssignmentSettings;
  newId: string;
}

export interface ChangePlan {
  /** the old row is CLOSED, never edited otherwise and never deleted */
  close: { id: string; effectiveTo: BusinessDate; isCurrent: false; endReason: 'CHANGED' };
  create: TeacherAssignment;
}

export function planChange(input: ChangeInput): ChangePlan {
  const settings = input.settings ?? DEFAULT_ASSIGNMENT_SETTINGS;
  const { current } = input;
  if (!current.isCurrent)
    throw new AcademicError(
      'ASSIGNMENT_NOT_CURRENT',
      'Only the current assignment can be changed.',
    );
  if (current.academicYearId !== input.year.id) {
    throw new AcademicError(
      'ASSIGNMENT_YEAR_MISMATCH',
      'The assignment belongs to a different academic year.',
    );
  }
  if (input.reason.trim().length < 3) {
    throw new AcademicError(
      'ASSIGNMENT_CHANGE_INVALID',
      'A reason is required to change the class teacher.',
    );
  }
  if (input.newTeacher.id === current.teacherId) {
    throw new AcademicError(
      'ASSIGNMENT_CHANGE_INVALID',
      'The new teacher is already the class teacher.',
    );
  }
  assertWithinYear(input.effectiveFrom, input.year);
  if (!isAfter(input.effectiveFrom, current.effectiveFrom)) {
    throw new AcademicError(
      'ASSIGNMENT_CHANGE_INVALID',
      'The change must take effect after the current assignment started.',
    );
  }
  assertTeacherCanTake(input.newTeacher, input.year, input.existing, settings, current.id);
  return {
    close: {
      id: current.id,
      effectiveTo: addDays(input.effectiveFrom, -1),
      isCurrent: false,
      endReason: 'CHANGED',
    },
    create: {
      id: input.newId,
      academicYearId: current.academicYearId,
      classId: current.classId,
      divisionId: current.divisionId,
      teacherId: input.newTeacher.id,
      role: current.role,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      isCurrent: true,
      replacesAssignmentId: current.id,
      reason: input.reason.trim(),
    },
  };
}

/* ------------------------------ historical context ------------------------------ */

/** the class teacher of a division on a given day (null if none) */
export function resolveTeacherAsOf(
  assignments: readonly TeacherAssignment[],
  divisionId: string,
  asOf: BusinessDate,
): TeacherAssignment | null {
  return (
    assignments.find(
      (a) =>
        a.divisionId === divisionId &&
        a.role === 'CLASS_TEACHER' &&
        !isAfter(a.effectiveFrom, asOf) &&
        (a.effectiveTo === null || !isBefore(a.effectiveTo, asOf)),
    ) ?? null
  );
}

/** every class teacher a division had during [from, to], oldest first, with the clipped date range */
export function teachersDuring(
  assignments: readonly TeacherAssignment[],
  divisionId: string,
  from: BusinessDate,
  to: BusinessDate,
): { assignment: TeacherAssignment; from: BusinessDate; to: BusinessDate }[] {
  return assignments
    .filter(
      (a) =>
        a.divisionId === divisionId &&
        a.role === 'CLASS_TEACHER' &&
        !isAfter(a.effectiveFrom, to) &&
        (a.effectiveTo === null || !isBefore(a.effectiveTo, from)),
    )
    .map((a) => ({
      assignment: a,
      from: maxDate(a.effectiveFrom, from),
      to: a.effectiveTo === null ? to : minDate(a.effectiveTo, to),
    }))
    .sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0));
}

/**
 * Teacher shown when viewing an academic year (CL-14): today for the running year, the year's end
 * date for a past year; `during` lists everyone who held the division in that period.
 */
export function teacherForYearView(
  assignments: readonly TeacherAssignment[],
  divisionId: string,
  year: AcademicYearRange,
  today: BusinessDate,
): {
  asOf: BusinessDate;
  teacher: TeacherAssignment | null;
  during: ReturnType<typeof teachersDuring>;
} {
  const asOf = isAfter(today, year.endDate)
    ? year.endDate
    : isBefore(today, year.startDate)
      ? year.startDate
      : today;
  return {
    asOf,
    teacher: resolveTeacherAsOf(assignments, divisionId, asOf),
    during: teachersDuring(assignments, divisionId, year.startDate, year.endDate),
  };
}
