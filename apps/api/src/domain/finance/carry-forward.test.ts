import { describe, expect, it } from 'vitest';
import { allocatePayment, planCarryForward, summarize, summarizeByAcademicYear, totalPending, type Receivable } from './index';
import { R, STUDENT, Y2025, Y2026, catchFinance, mk } from '../../testing/fixtures';

const S = { dueSoonDays: 7, expectedIncludesPenalties: false };
const TODAY = '2026-10-08';
const old = (): Receivable => mk({ id: 'old', no: 4, due: '2026-01-10', comps: { TUITION: R(8_000), TRANSPORT: R(2_000) }, year: Y2025 });
const baseInput = (sources: { receivable: Receivable; amount?: number }[]) => ({
  openingBalanceId: 'ob-cf',
  sources,
  targetAcademicYearId: Y2026,
  effectiveDate: '2026-04-01',
  reason: 'Institution decided to carry dues forward',
  existingActiveOpeningBalanceInTarget: false,
});

describe('manual carry-forward (never automatic — BRC-D1)', () => {
  it('moves the pending amount into an opening balance of the target year; total outstanding is unchanged', () => {
    const before = [old()];
    const plan = planCarryForward(baseInput([{ receivable: before[0] as Receivable }]));
    expect(plan.total).toBe(R(10_000));
    expect(plan.openingBalance).toMatchObject({ kind: 'OPENING_BALANCE', academicYearId: Y2026, payable: R(10_000), pending: R(10_000) });
    expect(totalPending(plan.updatedSources) + totalPending([plan.openingBalance])).toBe(totalPending(before));
    expect(plan.transfers).toEqual([{ receivableId: 'old', academicYearId: Y2025, amount: R(10_000) }]);
  });

  it('the source stays in its original year: marked TRANSFERRED, not collected, not discounted', () => {
    const plan = planCarryForward(baseInput([{ receivable: old() }]));
    const src = plan.updatedSources[0] as Receivable;
    expect(src).toMatchObject({ pending: 0, transferred: R(10_000), paid: 0, adjusted: 0, paymentStatus: 'TRANSFERRED', academicYearId: Y2025, version: 1 });
    const y = summarizeByAcademicYear([src, plan.openingBalance], TODAY, S);
    expect(y[0]?.summary).toMatchObject({ totalTransferred: R(10_000), totalOutstanding: 0, collectedFees: 0, discounts: 0, expectedFees: R(10_000) });
    expect(y[1]?.summary.openingBalance.pending).toBe(R(10_000));
  });

  it('can carry forward only part of a due, taking components in order', () => {
    const plan = planCarryForward(baseInput([{ receivable: old(), amount: R(9_000) }]));
    const src = plan.updatedSources[0] as Receivable;
    expect(src.pending).toBe(R(1_000));
    expect(src.components.map((c) => [c.code, c.transferred])).toEqual([['TUITION', R(8_000)], ['TRANSPORT', R(1_000)]]);
    expect(src.paymentStatus).toBe('UNPAID');
  });

  it('only the unpaid part moves: a partly paid due carries forward its remainder', () => {
    const partly = allocatePayment({ amount: R(4_000), receivables: [old()], today: TODAY }).updatedReceivables[0] as Receivable;
    const plan = planCarryForward(baseInput([{ receivable: partly }]));
    expect(plan.total).toBe(R(6_000));
    expect(plan.updatedSources[0]).toMatchObject({ paid: R(4_000), transferred: R(6_000), pending: 0 });
  });

  it('paying the new opening balance does not touch the old year', () => {
    const plan = planCarryForward(baseInput([{ receivable: old() }]));
    const all = [...plan.updatedSources, plan.openingBalance];
    const res = allocatePayment({ amount: R(10_000), receivables: all, today: TODAY });
    expect(res.allocations.map((a) => a.academicYearId)).toEqual([Y2026]);
    expect(summarize(res.updatedReceivables, TODAY, S).totalOutstanding).toBe(0);
  });

  it('combines several dues into one opening balance', () => {
    const a = old();
    const b = mk({ id: 'old2', no: 3, due: '2025-10-10', amount: R(500), year: Y2025 });
    const plan = planCarryForward(baseInput([{ receivable: a }, { receivable: b }]));
    expect(plan.total).toBe(R(10_500));
    expect(plan.transfers).toHaveLength(2);
  });

  it('is refused when it makes no sense', () => {
    const run = (input: ReturnType<typeof baseInput>): string => catchFinance(() => planCarryForward(input)).code;
    const r = old();
    expect(run({ ...baseInput([{ receivable: r }]), reason: ' ' })).toBe('CARRY_FORWARD_INVALID');
    expect(run(baseInput([]))).toBe('CARRY_FORWARD_INVALID');
    expect(run(baseInput([{ receivable: r }, { receivable: r }]))).toBe('CARRY_FORWARD_INVALID');
    expect(run(baseInput([{ receivable: r }, { receivable: mk({ id: 'o2', no: 1, due: '2025-05-01', amount: 10, year: Y2025, student: 'other' }) }]))).toBe('CARRY_FORWARD_INVALID');
    expect(run(baseInput([{ receivable: mk({ id: 'same', no: 1, due: '2026-05-01', amount: 10, year: Y2026 }) }]))).toBe('CARRY_FORWARD_INVALID');
    expect(run(baseInput([{ receivable: { ...r, hasPendingAdjustment: true } }]))).toBe('CARRY_FORWARD_INVALID');
    expect(run(baseInput([{ receivable: r, amount: R(10_001) }]))).toBe('CARRY_FORWARD_INVALID');
    expect(run(baseInput([{ receivable: r, amount: 0 }]))).toBe('CARRY_FORWARD_INVALID');
    const paid = allocatePayment({ amount: R(10_000), receivables: [r], today: TODAY }).updatedReceivables[0] as Receivable;
    expect(run(baseInput([{ receivable: paid }]))).toBe('CARRY_FORWARD_INVALID');
    expect(run({ ...baseInput([{ receivable: r }]), existingActiveOpeningBalanceInTarget: true })).toBe('OPENING_BALANCE_DUPLICATE');
    expect(STUDENT).toBeDefined();
  });
});
