import { describe, expect, it } from 'vitest';
import {
  planAssign,
  planChange,
  resolveTeacherAsOf,
  teacherForYearView,
  teachersDuring,
  type AcademicYearRange,
  type DivisionRef,
  type TeacherAssignment,
  type TeacherRef,
  planEnd,
} from './teacher-assignment';

const Y26: AcademicYearRange = { id: 'ay26', startDate: '2026-04-01', endDate: '2027-03-31' };
const Y25: AcademicYearRange = { id: 'ay25', startDate: '2025-04-01', endDate: '2026-03-31' };
const div = (id: string, year = 'ay26'): DivisionRef => ({
  id,
  classId: 'c5',
  academicYearId: year,
});
const teacher = (id: string, status: TeacherRef['status'] = 'ACTIVE'): TeacherRef => ({
  id,
  status,
});
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  throw new Error('expected a throw');
};

const assign = (
  d: DivisionRef,
  t: TeacherRef,
  existing: TeacherAssignment[] = [],
  extra: Partial<Parameters<typeof planAssign>[0]> = {},
): TeacherAssignment =>
  planAssign({
    division: d,
    teacher: t,
    year: Y26,
    effectiveFrom: '2026-04-01',
    existing,
    newId: `a-${d.id}-${t.id}`,
    ...extra,
  }).create;

describe('assign a class teacher (BRC-B6)', () => {
  it('creates an open-ended current assignment tied to year + class + division + teacher', () => {
    expect(assign(div('5A'), teacher('A'))).toEqual({
      id: 'a-5A-A',
      academicYearId: 'ay26',
      classId: 'c5',
      divisionId: '5A',
      teacherId: 'A',
      role: 'CLASS_TEACHER',
      effectiveFrom: '2026-04-01',
      effectiveTo: null,
      isCurrent: true,
    });
  });

  it('ONE teacher may be class teacher of MANY divisions (default: allowed)', () => {
    const a = assign(div('5A'), teacher('A'));
    const b = assign(div('5B'), teacher('A'), [a]);
    expect([a.teacherId, b.teacherId]).toEqual(['A', 'A']);
    expect([a.divisionId, b.divisionId]).toEqual(['5A', '5B']);
  });

  it('…unless the institution switches the setting off', () => {
    const a = assign(div('5A'), teacher('A'));
    expect(
      code(() =>
        assign(div('5B'), teacher('A'), [a], { settings: { allowMultipleDivisions: false } }),
      ),
    ).toBe('TEACHER_ALREADY_ASSIGNED');
    expect(() =>
      assign(div('5B'), teacher('B'), [a], { settings: { allowMultipleDivisions: false } }),
    ).not.toThrow();
  });

  it('a division can never have two active class teachers', () => {
    const a = assign(div('5A'), teacher('A'));
    expect(code(() => assign(div('5A'), teacher('B'), [a]))).toBe('DIVISION_ALREADY_HAS_TEACHER');
  });

  it('only active teachers; date must be inside the year; division must be of the same year', () => {
    expect(code(() => assign(div('5A'), teacher('A', 'INACTIVE')))).toBe('TEACHER_NOT_ACTIVE');
    expect(code(() => assign(div('5A'), teacher('A', 'LEFT')))).toBe('TEACHER_NOT_ACTIVE');
    expect(code(() => assign(div('5A'), teacher('A'), [], { effectiveFrom: '2026-03-31' }))).toBe(
      'EFFECTIVE_DATE_OUTSIDE_YEAR',
    );
    expect(code(() => assign(div('5A'), teacher('A'), [], { effectiveFrom: '2027-04-01' }))).toBe(
      'EFFECTIVE_DATE_OUTSIDE_YEAR',
    );
    expect(code(() => assign(div('5A', 'ay25'), teacher('A')))).toBe('ASSIGNMENT_YEAR_MISMATCH');
  });

  it('the same teacher can teach another class/division in ANOTHER year; the old year row is separate', () => {
    const y25 = planAssign({
      division: div('5A', 'ay25'),
      teacher: teacher('A'),
      year: Y25,
      effectiveFrom: '2025-04-01',
      existing: [],
      newId: 'old',
    }).create;
    const y26 = assign(div('6B'), teacher('A'), [y25]);
    expect(y25).toMatchObject({ academicYearId: 'ay25', divisionId: '5A', isCurrent: true });
    expect(y26).toMatchObject({ academicYearId: 'ay26', divisionId: '6B' });
  });
});

describe('change teacher — close + create, history preserved', () => {
  const current = assign(div('5A'), teacher('A'));
  const change = (patch: Partial<Parameters<typeof planChange>[0]> = {}) =>
    planChange({
      current,
      newTeacher: teacher('B'),
      year: Y26,
      effectiveFrom: '2026-09-01',
      reason: 'Teacher A moved to the senior wing',
      existing: [current],
      newId: 'new',
      ...patch,
    });

  it('closes the previous record the day before and opens a new one that points back to it', () => {
    const plan = change();
    expect(plan.close).toEqual({
      id: current.id,
      effectiveTo: '2026-08-31',
      isCurrent: false,
      endReason: 'CHANGED',
    });
    expect(plan.create).toMatchObject({
      teacherId: 'B',
      divisionId: '5A',
      effectiveFrom: '2026-09-01',
      effectiveTo: null,
      isCurrent: true,
      replacesAssignmentId: current.id,
    });
  });

  it('never leaves a gap or an overlap: old.effectiveTo + 1 day = new.effectiveFrom', () => {
    const plan = change({ effectiveFrom: '2026-12-15' });
    expect(plan.close.effectiveTo).toBe('2026-12-14');
  });

  it('validates the change', () => {
    expect(code(() => change({ reason: ' ' }))).toBe('ASSIGNMENT_CHANGE_INVALID');
    expect(code(() => change({ newTeacher: teacher('A') }))).toBe('ASSIGNMENT_CHANGE_INVALID');
    expect(code(() => change({ effectiveFrom: '2026-04-01' }))).toBe('ASSIGNMENT_CHANGE_INVALID');
    expect(code(() => change({ effectiveFrom: '2028-01-01' }))).toBe('EFFECTIVE_DATE_OUTSIDE_YEAR');
    expect(code(() => change({ newTeacher: teacher('B', 'INACTIVE') }))).toBe('TEACHER_NOT_ACTIVE');
    expect(code(() => change({ current: { ...current, isCurrent: false } }))).toBe(
      'ASSIGNMENT_NOT_CURRENT',
    );
    expect(code(() => change({ current: { ...current, academicYearId: 'ay25' } }))).toBe(
      'ASSIGNMENT_YEAR_MISMATCH',
    );
  });

  it('honours the one-division-per-teacher setting when moving a teacher who already has a division', () => {
    const other = assign(div('5B'), teacher('B'));
    expect(
      code(() =>
        change({ existing: [current, other], settings: { allowMultipleDivisions: false } }),
      ),
    ).toBe('TEACHER_ALREADY_ASSIGNED');
    expect(() => change({ existing: [current, other] })).not.toThrow();
  });
});

describe('historical context — the teacher of that period', () => {
  // 5-A: Teacher A Apr–Aug, Teacher B from Sep (changed mid-year)
  const first: TeacherAssignment = {
    ...assign(div('5A'), teacher('A')),
    effectiveTo: '2026-08-31',
    isCurrent: false,
    endReason: 'CHANGED',
  };
  const second: TeacherAssignment = {
    ...assign(div('5A'), teacher('B')),
    id: 'second',
    effectiveFrom: '2026-09-01',
    replacesAssignmentId: first.id,
  };
  const all = [first, second];

  it('as-of lookups follow the effective dates (inclusive boundaries)', () => {
    expect(resolveTeacherAsOf(all, '5A', '2026-04-01')?.teacherId).toBe('A');
    expect(resolveTeacherAsOf(all, '5A', '2026-08-31')?.teacherId).toBe('A');
    expect(resolveTeacherAsOf(all, '5A', '2026-09-01')?.teacherId).toBe('B');
    expect(resolveTeacherAsOf(all, '5A', '2027-03-31')?.teacherId).toBe('B');
    expect(resolveTeacherAsOf(all, '5A', '2026-03-31')).toBeNull();
    expect(resolveTeacherAsOf(all, '5B', '2026-09-01')).toBeNull();
  });

  it('lists everyone who held the division during a period, with clipped ranges', () => {
    const during = teachersDuring(all, '5A', '2026-04-01', '2027-03-31');
    expect(during.map((d) => [d.assignment.teacherId, d.from, d.to])).toEqual([
      ['A', '2026-04-01', '2026-08-31'],
      ['B', '2026-09-01', '2027-03-31'],
    ]);
    expect(
      teachersDuring(all, '5A', '2026-08-15', '2026-09-15').map((d) => [
        d.assignment.teacherId,
        d.from,
        d.to,
      ]),
    ).toEqual([
      ['A', '2026-08-15', '2026-08-31'],
      ['B', '2026-09-01', '2026-09-15'],
    ]);
    expect(teachersDuring(all, '5A', '2025-01-01', '2025-02-01')).toEqual([]);
  });

  it('a past-year view resolves the teacher at the end of that year; the running year uses today (CL-14)', () => {
    const pastView = teacherForYearView(all, '5A', Y26, '2028-01-01');
    expect(pastView.asOf).toBe('2027-03-31');
    expect(pastView.teacher?.teacherId).toBe('B');
    expect(pastView.during).toHaveLength(2);
    expect(teacherForYearView(all, '5A', Y26, '2026-06-15')).toMatchObject({
      asOf: '2026-06-15',
      teacher: { teacherId: 'A' },
    });
    expect(teacherForYearView(all, '5A', Y26, '2026-01-01').asOf).toBe('2026-04-01'); // future year → its start
  });

  it('a different year of the same division keeps its own teacher untouched', () => {
    const old: TeacherAssignment = {
      ...first,
      id: 'old',
      academicYearId: 'ay25',
      divisionId: '5A-25',
      effectiveFrom: '2025-04-01',
      effectiveTo: '2026-03-31',
      teacherId: 'Z',
      isCurrent: true,
    };
    expect(resolveTeacherAsOf([old, ...all], '5A-25', '2025-12-01')?.teacherId).toBe('Z');
    expect(teacherForYearView([old, ...all], '5A-25', Y25, '2026-10-08').teacher?.teacherId).toBe(
      'Z',
    );
  });
});

describe('end an assignment — the division is left without a class teacher', () => {
  const current = () => assign(div('d1'), teacher('t1'));
  const base = () => ({
    current: current(),
    year: Y26,
    effectiveTo: '2026-09-30',
    reason: 'Resigned',
  });

  it('closes the row with an end date and reason code, never deleting it', () => {
    expect(planEnd(base()).close).toEqual({
      id: 'a-d1-t1',
      effectiveTo: '2026-09-30',
      isCurrent: false,
      endReason: 'LEFT_INSTITUTION',
    });
  });
  it('needs a reason, a date inside the year and not before the start', () => {
    expect(code(() => planEnd({ ...base(), reason: ' ' }))).toBe('ASSIGNMENT_CHANGE_INVALID');
    expect(code(() => planEnd({ ...base(), effectiveTo: '2027-04-01' }))).toBe(
      'EFFECTIVE_DATE_OUTSIDE_YEAR',
    );
    expect(code(() => planEnd({ ...base(), effectiveTo: '2026-03-31' }))).toBe(
      'EFFECTIVE_DATE_OUTSIDE_YEAR',
    );
  });
  it('cannot end an assignment that is already closed', () => {
    const closed = { ...current(), isCurrent: false };
    expect(code(() => planEnd({ ...base(), current: closed }))).toBe('ASSIGNMENT_NOT_CURRENT');
  });
});
