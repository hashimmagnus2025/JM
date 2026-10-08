import { describe, expect, it } from 'vitest';
import {
  computeAnnualStudentCharge,
  countActiveStudents,
  isBillableStudentStatus,
  resolveBillingDate,
  type BillingEnrollment,
  type BillingStudent,
  type BillingStudentStatus,
} from './active-students';

const AY = 'ay26';
const enr = (studentId: string, patch: Partial<BillingEnrollment> = {}): BillingEnrollment => ({
  studentId,
  academicYearId: AY,
  status: 'ACTIVE',
  enrolledOn: '2026-04-01',
  endedOn: null,
  ...patch,
});
const stu = (id: string, status: BillingStudentStatus = 'ACTIVE'): BillingStudent => ({
  id,
  status,
});
const count = (students: BillingStudent[], enrollments: BillingEnrollment[], asOf = '2026-06-30') =>
  countActiveStudents({ students, enrollments, academicYearId: AY, asOf });

describe('annual student system charge (BRC-K1)', () => {
  it('counts unique students with an active enrollment', () => {
    expect(count([stu('a'), stu('b')], [enr('a'), enr('b')])).toEqual({
      count: 2,
      studentIds: ['a', 'b'],
    });
  });
  it('duplicate / multiple enrollment rows of the same student are charged ONCE', () => {
    // a division change inside the year creates a second row; a data-entry duplicate creates another
    const rows = [
      enr('a', { status: 'ENDED', endedOn: '2026-08-31' }),
      enr('a', { enrolledOn: '2026-09-01' }),
      enr('a'),
    ];
    expect(count([stu('a')], rows, '2026-09-15').count).toBe(1);
  });
  it('withdrawn, inactive, passed-out, transferred and archived students are never billed', () => {
    const statuses: BillingStudentStatus[] = [
      'WITHDRAWN',
      'INACTIVE',
      'PASSED_OUT',
      'TRANSFERRED',
      'ARCHIVED',
    ];
    statuses.forEach((s) => {
      expect(isBillableStudentStatus(s)).toBe(false);
      expect(count([stu('a', s)], [enr('a')]).count).toBe(0);
    });
    expect(isBillableStudentStatus('ACTIVE')).toBe(true);
  });
  it('only enrollments of the billing year, not cancelled, in force on the billing date', () => {
    expect(count([stu('a')], [enr('a', { academicYearId: 'ay25' })]).count).toBe(0);
    expect(count([stu('a')], [enr('a', { status: 'CANCELLED' })]).count).toBe(0);
    expect(count([stu('a')], [enr('a', { enrolledOn: '2026-07-01' })], '2026-06-30').count).toBe(0);
    expect(
      count([stu('a')], [enr('a', { status: 'ENDED', endedOn: '2026-06-29' })], '2026-06-30').count,
    ).toBe(0);
    expect(
      count([stu('a')], [enr('a', { status: 'ENDED', endedOn: '2026-06-30' })], '2026-06-30').count,
    ).toBe(1);
    expect(count([stu('a')], [enr('ghost')]).count).toBe(0); // no student record → not billable
  });
  it('SOW example: 100 students × ₹120 = ₹12,000 per year', () => {
    expect(computeAnnualStudentCharge({ activeCount: 100, ratePerStudentPaise: 12_000 })).toBe(
      1_200_000,
    );
    expect(computeAnnualStudentCharge({ activeCount: 0, ratePerStudentPaise: 12_000 })).toBe(0);
  });
  it('rejects nonsense input', () => {
    expect(() => computeAnnualStudentCharge({ activeCount: -1, ratePerStudentPaise: 1 })).toThrow(
      RangeError,
    );
    expect(() => computeAnnualStudentCharge({ activeCount: 1.5, ratePerStudentPaise: 1 })).toThrow(
      RangeError,
    );
    expect(() => computeAnnualStudentCharge({ activeCount: 1, ratePerStudentPaise: -1 })).toThrow(
      RangeError,
    );
  });
  it('billing point is configurable', () => {
    const year = { startDate: '2026-04-01' };
    expect(resolveBillingDate({ kind: 'ACADEMIC_YEAR_START' }, year, '2026-10-08')).toBe(
      '2026-04-01',
    );
    expect(resolveBillingDate({ kind: 'FIXED_DATE', date: '2026-06-30' }, year, '2026-10-08')).toBe(
      '2026-06-30',
    );
    expect(resolveBillingDate({ kind: 'ON_DEMAND' }, year, '2026-10-08')).toBe('2026-10-08');
  });
});
