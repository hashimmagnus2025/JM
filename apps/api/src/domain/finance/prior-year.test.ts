import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  buildFeePreview,
  buildInstallments,
  summarize,
  summarizeAll,
  summarizeByAcademicYear,
  type Receivable,
} from './index';
import { R, STUDENT, Y2025, Y2026, mk, tuition } from '../../testing/fixtures';

const S = { dueSoonDays: 7, expectedIncludesPenalties: false };
const TODAY = '2026-10-08';

describe('historical academic-year separation (BRC-D1: keep ORIGINAL YEAR)', () => {
  // 2025-26: one installment of ₹10,000 still unpaid · 2026-27: new fee ₹50,000
  const old: Receivable = mk({ id: 'old', no: 4, due: '2026-01-10', amount: R(10_000), year: Y2025 });
  const fees = buildInstallments({
    assignmentId: 'asg-26',
    studentId: STUDENT,
    academicYearId: Y2026,
    lines: [tuition(R(50_000))],
    plan: { kind: 'FULL', dueDate: '2026-04-10' },
  });
  const all = [old, ...fees];

  it('financial history shows each year separately: 2025-26 ₹10,000 and 2026-27 ₹50,000', () => {
    const years = summarizeByAcademicYear(all, TODAY, S);
    expect(years.map((y) => [y.academicYearId, y.summary.totalOutstanding])).toEqual([
      [Y2025, R(10_000)],
      [Y2026, R(50_000)],
    ]);
  });

  it('the cross-year total receivable aggregates both, without merging ownership', () => {
    expect(summarizeAll(all, TODAY, S).totalOutstanding).toBe(R(60_000));
  });

  it('no opening balance is created automatically for the new year', () => {
    expect(all.filter((r) => r.kind === 'OPENING_BALANCE')).toHaveLength(0);
    const preview = buildFeePreview({
      asOf: TODAY,
      assignmentId: 'asg-26',
      studentId: STUDENT,
      academicYearId: Y2026,
      lines: [tuition(R(50_000))],
      plan: { kind: 'FULL', dueDate: '2026-04-10' },
      existingReceivables: [old],
    });
    expect(preview.receivables.filter((r) => r.kind === 'OPENING_BALANCE')).toHaveLength(0);
    expect(preview.summary.openingBalance).toBe(0);
    expect(preview.summary.currentOutstanding).toBe(R(50_000)); // this year only
    expect(preview.summary.totalOutstandingAllYears).toBe(R(60_000)); // plus the prior year
  });

  it('building / changing the new year never touches the old year receivables', () => {
    const before = JSON.stringify(old);
    buildFeePreview({
      asOf: TODAY,
      assignmentId: 'asg-26',
      studentId: STUDENT,
      academicYearId: Y2026,
      lines: [tuition(R(99_999))],
      plan: { kind: 'FULL', dueDate: '2026-04-10' },
      existingReceivables: [old],
    });
    expect(JSON.stringify(old)).toBe(before);
  });

  it('a payment clears the older year first and every allocation keeps its own academic year', () => {
    const res = allocatePayment({ amount: R(25_000), receivables: all, today: TODAY });
    expect(res.allocations.map((a) => [a.receivableId, a.academicYearId, a.amount])).toEqual([
      ['old', Y2025, R(10_000)],
      [fees[0]?.id, Y2026, R(15_000)],
    ]);
    const after = summarizeByAcademicYear(res.updatedReceivables, TODAY, S);
    expect(after.map((y) => y.summary.totalOutstanding)).toEqual([0, R(35_000)]);
    expect(after[0]?.summary.totalPaid).toBe(R(10_000));
    expect(after[1]?.summary.totalPaid).toBe(R(15_000));
  });

  it('collection % of the new year is not polluted by the old year payment', () => {
    const res = allocatePayment({ amount: R(10_000), receivables: all, today: TODAY });
    const y26 = summarize(res.updatedReceivables.filter((r) => r.academicYearId === Y2026), TODAY, S);
    expect(y26.collectionBp).toBe(0);
    expect(y26.expectedFees).toBe(R(50_000));
  });

  it('a payment can be restricted to the current year only (cashier selects those dues)', () => {
    const res = allocatePayment({ amount: R(5_000), receivables: all, today: TODAY, eligibleReceivableIds: [fees[0]?.id as string] });
    expect(res.allocations.map((a) => a.academicYearId)).toEqual([Y2026]);
    expect(res.updatedReceivables.find((r) => r.id === 'old')?.pending).toBe(R(10_000));
  });

  it('historical payments entered at admission also settle the oldest year first', () => {
    const preview = buildFeePreview({
      asOf: TODAY,
      assignmentId: 'asg-26',
      studentId: STUDENT,
      academicYearId: Y2026,
      lines: [tuition(R(50_000))],
      plan: { kind: 'FULL', dueDate: '2026-04-10' },
      existingReceivables: [old],
      historicalPayments: [{ amount: R(12_000), paymentDate: '2026-05-01' }],
    });
    expect(preview.existingAfter.find((r) => r.id === 'old')?.pending).toBe(0);
    expect(preview.summary.paidToOtherYears).toBe(R(10_000));
    expect(preview.summary.alreadyPaid).toBe(R(2_000));
    expect(preview.summary.currentOutstanding).toBe(R(48_000));
  });
});
