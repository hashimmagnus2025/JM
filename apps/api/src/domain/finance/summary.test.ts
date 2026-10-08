import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocatePayment, applyAdjustment, planCarryForward, resolveAdjustment, summarize, summarizeAll, summarizeByAcademicYear, type Receivable } from './index';
import { R, Y2025, Y2026, mk } from '../../testing/fixtures';

const S = { dueSoonDays: 7, expectedIncludesPenalties: false };
const TODAY = '2026-10-08';

const sample = (): Receivable[] => [
  mk({ id: 'ob', kind: 'OPENING_BALANCE', due: '2026-04-01', amount: R(10_000) }),
  mk({ id: 'i1', no: 1, due: '2026-04-10', amount: R(20_000) }),
  mk({ id: 'i2', no: 2, due: '2026-10-10', amount: R(20_000) }),
  mk({ id: 'pen', kind: 'PENALTY', due: '2026-05-01', amount: R(500), parent: 'i1', periodKey: 'ONCE' }),
];

describe('metrics (decision register BRC-I1/I2)', () => {
  it('Expected Fees = installments after discounts; opening balance and penalties are separate lines', () => {
    const s = summarize(sample(), TODAY, S);
    expect(s).toMatchObject({ grossFee: R(40_000), expectedFees: R(40_000), totalReceivable: R(50_500), totalOutstanding: R(50_500) });
    expect(s.openingBalance.payable).toBe(R(10_000));
    expect(s.penalties.payable).toBe(R(500));
  });
  it('penalties join Expected Fees only when configured', () => {
    const s = summarize(sample(), TODAY, { ...S, expectedIncludesPenalties: true });
    expect(s.expectedFees).toBe(R(40_500));
  });
  it('discounts reduce Expected; Gross fee stays traceable', () => {
    const rs = sample();
    const adj = resolveAdjustment({ mode: 'FIXED', value: R(4_000), basis: 'TOTAL_FEE', distribution: 'EARLIEST_FIRST' }, rs);
    const s = summarize(applyAdjustment(rs, adj.applications), TODAY, S);
    expect(s).toMatchObject({ grossFee: R(40_000), discounts: R(4_000), expectedFees: R(36_000), totalOutstanding: R(46_500) });
  });
  it('Collection % = collected ÷ expected, in basis points; opening-balance payments do not count', () => {
    const paid = allocatePayment({ amount: R(10_000), receivables: sample(), today: TODAY }).updatedReceivables;
    const s = summarize(paid, TODAY, S);
    // oldest first: opening balance (10,000) is paid before any fee
    expect(s.openingBalance.paid).toBe(R(10_000));
    expect(s.collectedFees).toBe(0);
    expect(s.collectionBp).toBe(0);
    const more = allocatePayment({ amount: R(10_000), receivables: paid, today: TODAY }).updatedReceivables;
    expect(summarize(more, TODAY, S).collectionBp).toBe(2_500);
  });
  it('collection % is 0 (never NaN) when nothing is expected, and never exceeds 100 %', () => {
    expect(summarize([], TODAY, S).collectionBp).toBe(0);
    const all = allocatePayment({ amount: R(50_500), receivables: sample(), today: TODAY }).updatedReceivables;
    const s = summarize(all, TODAY, S);
    expect(s.collectionBp).toBe(10_000);
    expect(s.totalOutstanding).toBe(0);
  });
  it('overdue · due soon · not yet due partition the outstanding', () => {
    const s = summarize(sample(), TODAY, S);
    expect(s.overdue).toBe(R(10_000 + 20_000 + 500));
    expect(s.dueSoon).toBe(R(20_000));
    expect(s.notYetDue).toBe(0);
    expect(s.overdue + s.dueSoon + s.notYetDue).toBe(s.totalOutstanding);
  });
  it('next installment = earliest pending installment due on/after today', () => {
    expect(summarize(sample(), TODAY, S).nextInstallment).toMatchObject({ receivableId: 'i2', dueDate: '2026-10-10', pending: R(20_000) });
    const none = allocatePayment({ amount: R(50_500), receivables: sample(), today: TODAY }).updatedReceivables;
    expect(summarize(none, TODAY, S).nextInstallment).toBeNull();
  });
  it('void receivables are ignored', () => {
    const rs = [...sample(), { ...mk({ id: 'v', no: 9, due: '2026-04-10', amount: R(99_999) }), paymentStatus: 'VOID' as const }];
    expect(summarize(rs, TODAY, S).totalOutstanding).toBe(R(50_500));
  });
  it('carried-forward amounts are tracked in their own bucket: collected + pending + transferred = expected', () => {
    const old = mk({ id: 'old', no: 4, due: '2026-01-10', amount: R(10_000), year: Y2025 });
    const partly = allocatePayment({ amount: R(3_000), receivables: [old], today: TODAY }).updatedReceivables[0] as Receivable;
    const plan = planCarryForward({ openingBalanceId: 'ob', sources: [{ receivable: partly }], targetAcademicYearId: Y2026, effectiveDate: '2026-04-01', reason: 'carry', existingActiveOpeningBalanceInTarget: false });
    const s = summarize(plan.updatedSources, TODAY, S);
    expect(s).toMatchObject({ expectedFees: R(10_000), collectedFees: R(3_000), totalTransferred: R(7_000), totalOutstanding: 0 });
    expect(s.collectedFees + s.totalOutstanding + s.totalTransferred).toBe(s.expectedFees);
  });
  it('per-year summaries keep ownership and are ordered by their earliest due date; the all-years total adds up', () => {
    const rs = [mk({ id: 'n', no: 1, due: '2026-04-10', amount: R(50), year: Y2026 }), mk({ id: 'o', no: 1, due: '2025-04-10', amount: R(10), year: Y2025 })];
    expect(summarizeByAcademicYear(rs, TODAY, S).map((y) => y.academicYearId)).toEqual([Y2025, Y2026]);
    expect(summarizeAll(rs, TODAY, S).totalOutstanding).toBe(R(60));
  });
});

describe('PROPERTY — outstanding is always receivable − paid, whatever happens', () => {
  it('after random payments the derived outstanding equals Σ payable − Σ adjusted − Σ transferred − Σ paid', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 2_000_000 }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.double({ min: 0.01, max: 0.6, noNaN: true }), { minLength: 0, maxLength: 5 }),
        (amounts, fractions) => {
          let rs = amounts.map((a, i) => mk({ id: `r${i}`, no: i + 1, due: `2026-${String((i % 12) + 1).padStart(2, '0')}-10`, amount: a }));
          for (const f of fractions) {
            const pending = rs.reduce((s, r) => s + r.pending, 0);
            if (pending === 0) break;
            rs = allocatePayment({ amount: Math.max(1, Math.floor(pending * f)), receivables: rs, today: TODAY }).updatedReceivables;
          }
          const s = summarize(rs, TODAY, S);
          expect(s.totalOutstanding).toBe(rs.reduce((a, r) => a + r.payable - r.adjusted - r.transferred - r.paid, 0));
          expect(s.collectionBp).toBeLessThanOrEqual(10_000);
        },
      ),
    );
  });
});
