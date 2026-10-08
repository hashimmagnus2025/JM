import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  buildFeePreview,
  buildOpeningBalanceReceivable,
  computeAging,
  openingBalanceDedupeKey,
  summarize,
  validateOpeningBalance,
  type OpeningBalanceContext,
  type OpeningBalanceInput,
} from './index';
import { R, STUDENT, Y2025, Y2026, catchFinance, mk, tuition } from '../../testing/fixtures';

const input: OpeningBalanceInput = {
  id: 'ob-1',
  studentId: STUDENT,
  academicYearId: Y2026,
  amount: R(15_000),
  effectiveDate: '2026-04-01',
  source: 'MIGRATION',
  reason: 'Outstanding carried from the old register',
};
const ctx = { existingActive: false };

describe('opening balance (requirement #3)', () => {
  it('becomes exactly one OPENING_BALANCE receivable with the system component', () => {
    const r = buildOpeningBalanceReceivable(input, ctx);
    expect(r).toMatchObject({
      kind: 'OPENING_BALANCE',
      label: 'Opening balance',
      payable: R(15_000),
      pending: R(15_000),
      dueDate: '2026-04-01',
      dedupeKey: openingBalanceDedupeKey('ob-1'),
    });
    expect(r.components).toHaveLength(1);
    expect(r.components[0]?.code).toBe('OPENING_BALANCE');
  });

  it('uses an explicit due date when supplied (aging basis, BRC-I2)', () => {
    const r = buildOpeningBalanceReceivable({ ...input, dueDate: '2026-06-30' }, ctx);
    expect(r.dueDate).toBe('2026-06-30');
    expect(r.originalDueDate).toBe('2026-06-30');
  });

  it('does NOT create another ₹15,000 fee: gross fee is unchanged, outstanding rises by exactly the balance', () => {
    const common = {
      asOf: '2026-10-08',
      assignmentId: 'a',
      studentId: STUDENT,
      academicYearId: Y2026,
      lines: [tuition(R(50_000))],
      plan: { kind: 'FULL' as const, dueDate: '2026-04-10' },
    };
    const without = buildFeePreview(common);
    const withOb = buildFeePreview({ ...common, openingBalance: { id: 'ob-1', amount: R(15_000), effectiveDate: '2026-04-01', source: 'MIGRATION', reason: 'migration' } });
    expect(withOb.summary.applicableFee).toBe(without.summary.applicableFee);
    expect(withOb.yearSummary.expectedFees).toBe(without.yearSummary.expectedFees);
    expect(withOb.summary.openingBalance).toBe(R(15_000));
    expect(withOb.summary.currentOutstanding - without.summary.currentOutstanding).toBe(R(15_000));
    expect(withOb.receivables.filter((r) => r.kind === 'OPENING_BALANCE')).toHaveLength(1);
  });

  it('is excluded from Expected Fees and Collection % but shown on its own line', () => {
    const ob = buildOpeningBalanceReceivable(input, ctx);
    const fee = mk({ id: 'f', no: 1, due: '2026-04-10', amount: R(50_000) });
    const paid = allocatePayment({ amount: R(20_000), receivables: [ob, fee], today: '2026-10-08' }).updatedReceivables;
    const s = summarize(paid, '2026-10-08', { dueSoonDays: 7, expectedIncludesPenalties: false });
    expect(s.expectedFees).toBe(R(50_000));
    expect(s.openingBalance).toMatchObject({ payable: R(15_000), paid: R(15_000), pending: 0 });
    expect(s.collectedFees).toBe(R(5_000)); // oldest-first: ₹15,000 cleared the opening balance, ₹5,000 reached the fee
    expect(s.collectionBp).toBe(1_000);
  });

  it('is paid first by oldest-due-first allocation', () => {
    const ob = buildOpeningBalanceReceivable(input, ctx);
    const fee = mk({ id: 'f', no: 1, due: '2026-04-10', amount: R(50_000) });
    const res = allocatePayment({ amount: R(10_000), receivables: [fee, ob], today: '2026-10-08' });
    expect(res.allocations.map((a) => a.receivableId)).toEqual([ob.id]);
  });

  it('ages from its effective/due date', () => {
    const ob = buildOpeningBalanceReceivable(input, ctx);
    const aging = computeAging([ob], '2026-10-08', { agingBoundaries: [30, 60, 90], agingBasis: 'ORIGINAL_DUE_DATE' });
    expect(aging.d90plus.amount).toBe(R(15_000)); // 190 days
  });

  it('a duplicate opening balance for the same student-year is blocked', () => {
    expect(catchFinance(() => buildOpeningBalanceReceivable(input, { existingActive: true })).code).toBe('OPENING_BALANCE_DUPLICATE');
  });

  it('the same opening balance document always maps to the same dedupe key', () => {
    expect(buildOpeningBalanceReceivable(input, ctx).dedupeKey).toBe(buildOpeningBalanceReceivable(input, ctx).dedupeKey);
  });

  it('validates amount, dates and reason', () => {
    const bad = (patch: Partial<OpeningBalanceInput>, c: OpeningBalanceContext = ctx): string => catchFinance(() => validateOpeningBalance({ ...input, ...patch }, c)).code;
    expect(bad({ amount: 0 })).toBe('OPENING_BALANCE_INVALID');
    expect(bad({ amount: -100 })).toBe('OPENING_BALANCE_INVALID');
    expect(bad({ amount: 10.5 })).toBe('OPENING_BALANCE_INVALID');
    expect(bad({ reason: ' x ' })).toBe('OPENING_BALANCE_INVALID');
    expect(bad({ dueDate: '2026-03-01' })).toBe('OPENING_BALANCE_INVALID');
    expect(bad({ effectiveDate: '2027-05-01' }, { existingActive: false, academicYear: { startDate: '2026-04-01', endDate: '2027-03-31' } })).toBe('OPENING_BALANCE_INVALID');
    expect(() => validateOpeningBalance(input, { existingActive: false, academicYear: { startDate: '2026-04-01', endDate: '2027-03-31' } })).not.toThrow();
    expect(() => validateOpeningBalance({ ...input, effectiveDate: '2026-02-30' }, ctx)).toThrow();
  });

  it('a preview refuses a second opening balance when the student already has one for the year', () => {
    const existing = buildOpeningBalanceReceivable(input, ctx);
    const e = catchFinance(() =>
      buildFeePreview({
        asOf: '2026-10-08', assignmentId: 'a', studentId: STUDENT, academicYearId: Y2026, lines: [tuition(100)], plan: { kind: 'FULL', dueDate: '2026-04-10' },
        openingBalance: { id: 'ob-2', amount: 500, effectiveDate: '2026-04-01', source: 'MANUAL', reason: 'again' },
        existingReceivables: [existing],
      }),
    );
    expect(e.code).toBe('OPENING_BALANCE_DUPLICATE');
    // …but an opening balance of ANOTHER year does not block it
    const prior = buildOpeningBalanceReceivable({ ...input, id: 'ob-old', academicYearId: Y2025 }, ctx);
    expect(() =>
      buildFeePreview({
        asOf: '2026-10-08', assignmentId: 'a', studentId: STUDENT, academicYearId: Y2026, lines: [tuition(100)], plan: { kind: 'FULL', dueDate: '2026-04-10' },
        openingBalance: { id: 'ob-2', amount: 500, effectiveDate: '2026-04-01', source: 'MANUAL', reason: 'again' },
        existingReceivables: [prior],
      }),
    ).not.toThrow();
  });
});
