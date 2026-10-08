import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  applyAdjustment,
  assertReceivable,
  buildInstallments,
  derivePaymentState,
  flagPendingAdjustment,
  resolveAdjustment,
  reverseAdjustment,
  summarize,
  type AdjustmentRequest,
  type Receivable,
} from './index';
import { R, STUDENT, Y2026, catchFinance, deepFreeze, line, mk, tuition } from '../../testing/fixtures';

const four = (): Receivable[] =>
  buildInstallments({
    assignmentId: 'a',
    studentId: STUDENT,
    academicYearId: Y2026,
    lines: [tuition(R(50_000))],
    plan: {
      kind: 'STANDARD',
      plan: { planCode: 'p', installments: ['2026-04-10', '2026-07-10', '2026-10-10', '2027-01-10'].map((dueDate, i) => ({ no: i + 1, dueDate })) },
    },
  });
const req = (patch: Partial<AdjustmentRequest> = {}): AdjustmentRequest => ({ mode: 'FIXED', value: R(5_000), basis: 'TOTAL_FEE', distribution: 'LATEST_FIRST', ...patch });
const S = { dueSoonDays: 7, expectedIncludesPenalties: false };

describe('discount / concession / scholarship / waiver', () => {
  it('fixed concession, latest-first → lands on the last installment; original payable is preserved', () => {
    const rs = deepFreeze(four());
    const res = resolveAdjustment(req(), rs);
    expect(res.amount).toBe(R(5_000));
    expect(res.applications).toEqual([{ receivableId: 'FEE_ASSIGNMENT:a:4', componentCode: 'TUITION', amount: R(5_000) }]);
    const after = applyAdjustment(rs, res.applications);
    const last = after[3] as Receivable;
    expect(last).toMatchObject({ payable: R(12_500), adjusted: R(5_000), pending: R(7_500) });
    expect(summarize(after, '2026-10-08', S)).toMatchObject({ grossFee: R(50_000), discounts: R(5_000), expectedFees: R(45_000) });
  });

  it('earliest-first spills into the next installment when the first is too small', () => {
    const rs = four();
    const res = resolveAdjustment(req({ mode: 'FIXED', value: R(15_000), distribution: 'EARLIEST_FIRST' }), rs);
    expect(res.applications.map((a) => [a.receivableId.slice(-1), a.amount])).toEqual([['1', R(12_500)], ['2', R(2_500)]]);
  });

  it('percentage of total fee: 10 % of ₹50,000 = ₹5,000 (proportional over the open installments)', () => {
    const res = resolveAdjustment(req({ mode: 'PERCENT_BP', value: 1_000, distribution: 'PROPORTIONAL' }), four());
    expect(res.amount).toBe(R(5_000));
    expect(res.applications.map((a) => a.amount)).toEqual([R(1_250), R(1_250), R(1_250), R(1_250)]);
  });

  it('component basis only touches that component', () => {
    const rs = buildInstallments({
      assignmentId: 'b', studentId: STUDENT, academicYearId: Y2026,
      lines: [tuition(R(8_000)), line('TRANSPORT', R(2_000))], plan: { kind: 'FULL', dueDate: '2026-04-10' },
    });
    const res = resolveAdjustment({ mode: 'PERCENT_BP', value: 5_000, basis: 'COMPONENT', componentCode: 'TRANSPORT', distribution: 'PROPORTIONAL' }, rs);
    expect(res).toMatchObject({ amount: R(1_000), applications: [{ componentCode: 'TRANSPORT', amount: R(1_000) }] });
  });

  it('percentage rounding is half-up to the paisa and exact in total', () => {
    const rs = buildInstallments({ assignmentId: 'c', studentId: STUDENT, academicYearId: Y2026, lines: [tuition(1_005)], plan: { kind: 'FULL', dueDate: '2026-04-10' } });
    expect(resolveAdjustment({ mode: 'PERCENT_BP', value: 5_000, basis: 'TOTAL_FEE', distribution: 'PROPORTIONAL' }, rs).amount).toBe(503);
  });

  it('proportional distribution weights by what is still payable and always sums exactly', () => {
    const a = mk({ id: 'a', no: 1, due: '2026-04-10', amount: 300 });
    const b = mk({ id: 'b', no: 2, due: '2026-05-10', amount: 700 });
    const res = resolveAdjustment(req({ value: 101, distribution: 'PROPORTIONAL' }), [a, b]);
    expect(res.applications.reduce((s, x) => s + x.amount, 0)).toBe(101);
    expect(res.applications.map((x) => x.amount)).toEqual([30, 71]);
  });

  it('a waiver can target ONE receivable of any kind (e.g. a late fee)', () => {
    const pen = mk({ id: 'pen', kind: 'PENALTY', due: '2026-10-01', amount: R(200), parent: 'p', periodKey: 'ONCE' });
    const res = resolveAdjustment({ mode: 'FIXED', value: R(200), basis: 'RECEIVABLE', receivableId: 'pen', distribution: 'PROPORTIONAL' }, [pen]);
    const after = applyAdjustment([pen], res.applications)[0] as Receivable;
    expect(after).toMatchObject({ pending: 0, adjusted: R(200), paymentStatus: 'WAIVED' });
  });

  it('TOTAL_FEE concessions never touch opening balance or penalties', () => {
    const ob = mk({ id: 'ob', kind: 'OPENING_BALANCE', due: '2026-04-01', amount: R(10_000) });
    const e = catchFinance(() => resolveAdjustment(req({ value: R(1) }), [ob]));
    expect(e.code).toBe('ADJUSTMENT_EXCEEDS_PAYABLE'); // no fee capacity at all
  });

  it('SPECIFIC applications are validated against what is still payable', () => {
    const rs = four();
    const ok = resolveAdjustment({ mode: 'FIXED', value: 0, basis: 'TOTAL_FEE', distribution: 'SPECIFIC', specific: [{ receivableId: 'FEE_ASSIGNMENT:a:2', componentCode: 'TUITION', amount: R(100) }] }, rs);
    expect(ok.amount).toBe(R(100));
    const bad = (specific: { receivableId: string; componentCode: string; amount: number }[]): string =>
      catchFinance(() => resolveAdjustment({ mode: 'FIXED', value: 0, basis: 'TOTAL_FEE', distribution: 'SPECIFIC', specific }, rs)).code;
    expect(bad([])).toBe('ADJUSTMENT_INVALID');
    expect(bad([{ receivableId: 'nope', componentCode: 'TUITION', amount: 1 }])).toBe('ADJUSTMENT_INVALID');
    expect(bad([{ receivableId: 'FEE_ASSIGNMENT:a:1', componentCode: 'TUITION', amount: 0 }])).toBe('ADJUSTMENT_AMOUNT_INVALID');
    expect(bad([{ receivableId: 'FEE_ASSIGNMENT:a:1', componentCode: 'TUITION', amount: R(12_501) }])).toBe('ADJUSTMENT_EXCEEDS_PAYABLE');
    expect(bad([{ receivableId: 'FEE_ASSIGNMENT:a:1', componentCode: 'TUITION', amount: R(12_000) }, { receivableId: 'FEE_ASSIGNMENT:a:1', componentCode: 'TUITION', amount: R(1_000) }])).toBe('ADJUSTMENT_EXCEEDS_PAYABLE');
  });

  it('can never push a due below what has already been paid (that would be a refund)', () => {
    const paid = allocatePayment({ amount: R(12_500), receivables: four(), today: '2026-10-08' }).updatedReceivables;
    // installment 1 is fully paid → only 37,500 of capacity left
    expect(catchFinance(() => resolveAdjustment(req({ value: R(40_000), distribution: 'EARLIEST_FIRST' }), paid)).code).toBe('ADJUSTMENT_EXCEEDS_PAYABLE');
    const ok = resolveAdjustment(req({ value: R(37_500), distribution: 'EARLIEST_FIRST' }), paid);
    expect(ok.applications.every((a) => a.receivableId !== 'FEE_ASSIGNMENT:a:1')).toBe(true);
  });

  it('rejects zero, negative and nonsensical requests', () => {
    expect(catchFinance(() => resolveAdjustment(req({ value: 0 }), four())).code).toBe('ADJUSTMENT_AMOUNT_INVALID');
    expect(catchFinance(() => resolveAdjustment(req({ value: -1 }), four())).code).toBe('ADJUSTMENT_AMOUNT_INVALID');
    expect(catchFinance(() => resolveAdjustment(req({ mode: 'PERCENT_BP', value: 0 }), four())).code).toBe('ADJUSTMENT_AMOUNT_INVALID');
    expect(catchFinance(() => resolveAdjustment(req({ mode: 'PERCENT_BP', value: 10_001 }), four())).code).toBe('ADJUSTMENT_AMOUNT_INVALID');
    expect(catchFinance(() => resolveAdjustment(req({ basis: 'COMPONENT' }), four())).code).toBe('ADJUSTMENT_INVALID');
    expect(catchFinance(() => resolveAdjustment(req({ basis: 'RECEIVABLE' }), four())).code).toBe('ADJUSTMENT_INVALID');
    expect(catchFinance(() => resolveAdjustment(req({ value: R(50_001) }), four())).code).toBe('ADJUSTMENT_EXCEEDS_PAYABLE');
  });

  it('a 100 % waiver zeroes the due and marks it WAIVED', () => {
    const rs = [mk({ id: 'x', no: 1, due: '2026-04-10', amount: R(1_000) })];
    const res = resolveAdjustment({ mode: 'PERCENT_BP', value: 10_000, basis: 'TOTAL_FEE', distribution: 'PROPORTIONAL' }, rs);
    expect(applyAdjustment(rs, res.applications)[0]).toMatchObject({ pending: 0, paymentStatus: 'WAIVED' });
  });

  it('reversal gives back exactly what was adjusted; reversing twice is impossible', () => {
    const rs = four();
    const res = resolveAdjustment(req(), rs);
    const applied = applyAdjustment(rs, res.applications);
    const undone = reverseAdjustment(applied, res.applications);
    expect(undone.map((r) => [r.adjusted, r.pending])).toEqual(rs.map((r) => [r.adjusted, r.pending]));
    expect(catchFinance(() => reverseAdjustment(undone, res.applications)).code).toBe('INVARIANT_VIOLATION');
    expect(catchFinance(() => applyAdjustment(rs, [{ receivableId: 'FEE_ASSIGNMENT:a:1', componentCode: 'NOPE', amount: 1 }])).code).toBe('ADJUSTMENT_INVALID');
  });

  it('an unapproved adjustment only flags the due; zero-balance dues then show PENDING_ADJUSTMENT, not PAID (BRC-I1)', () => {
    const paid = allocatePayment({ amount: R(12_500), receivables: four(), today: '2026-10-08' }).updatedReceivables;
    expect(derivePaymentState(paid[0] as Receivable)).toBe('PAID');
    const flagged = flagPendingAdjustment(paid, [{ receivableId: 'FEE_ASSIGNMENT:a:1', componentCode: 'TUITION', amount: 1 }]);
    expect(derivePaymentState(flagged[0] as Receivable)).toBe('PENDING_ADJUSTMENT');
    expect(flagged[0]?.pending).toBe(0);
    expect(flagged[1]).toBe(paid[1]);
  });
});

describe('PROPERTY — adjustments are exact and never exceed capacity', () => {
  it('Σ applications = amount, each ≤ capacity, invariants hold after applying', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 8 }),
        fc.constantFrom<'PROPORTIONAL' | 'EARLIEST_FIRST' | 'LATEST_FIRST'>('PROPORTIONAL', 'EARLIEST_FIRST', 'LATEST_FIRST'),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (amounts, distribution, frac) => {
          const rs = amounts.map((a, i) => mk({ id: `r${i}`, no: i + 1, due: `2026-${String((i % 12) + 1).padStart(2, '0')}-10`, amount: a }));
          const total = amounts.reduce((a, b) => a + b, 0);
          const value = Math.max(1, Math.floor(total * frac));
          const res = resolveAdjustment({ mode: 'FIXED', value, basis: 'TOTAL_FEE', distribution }, rs);
          expect(res.amount).toBe(value);
          expect(res.applications.reduce((s, a) => s + a.amount, 0)).toBe(value);
          const after = applyAdjustment(rs, res.applications);
          after.forEach(assertReceivable);
          expect(after.reduce((s, r) => s + r.pending, 0)).toBe(total - value);
        },
      ),
      { numRuns: 300 },
    );
  });
});
