import { describe, expect, it } from 'vitest';
import { agingDays, bucketOf, computeAging, type Receivable } from './index';
import { R, mk } from '../../testing/fixtures';

const CFG = {
  agingBoundaries: [30, 60, 90] as [number, number, number],
  agingBasis: 'ORIGINAL_DUE_DATE' as const,
};

describe('aging buckets (BRC-I2): 0–30 · 31–60 · 61–90 · 90+', () => {
  it('bucket boundaries are inclusive of the upper limit; negative days are not yet due', () => {
    const b = (d: number): string => bucketOf(d, [30, 60, 90]);
    expect([-1, 0, 1, 30, 31, 60, 61, 90, 91, 400].map(b)).toEqual([
      'notYetDue',
      'd0_30',
      'd0_30',
      'd0_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'd90plus',
      'd90plus',
    ]);
  });
  it('boundaries are configurable', () => {
    expect(bucketOf(45, [15, 45, 90])).toBe('d31_60');
    expect(bucketOf(46, [15, 45, 90])).toBe('d61_90');
  });
  it('ages pending amounts from the due date and counts each receivable once', () => {
    const today = '2026-10-08';
    const rs = [
      mk({ id: 'due-today', no: 1, due: '2026-10-08', amount: R(100) }), // 0 days → 0–30 (CL-11)
      mk({ id: 'a', no: 2, due: '2026-09-20', amount: R(200) }), // 18
      mk({ id: 'b', no: 3, due: '2026-08-20', amount: R(300) }), // 49
      mk({ id: 'c', no: 4, due: '2026-07-20', amount: R(400) }), // 80
      mk({ id: 'd', no: 5, due: '2026-04-10', amount: R(500) }), // 181
      mk({ id: 'future', no: 6, due: '2027-01-10', amount: R(600) }),
    ];
    const a = computeAging(rs, today, CFG);
    expect(a.d0_30).toEqual({ amount: R(300), count: 2 });
    expect(a.d31_60).toEqual({ amount: R(300), count: 1 });
    expect(a.d61_90).toEqual({ amount: R(400), count: 1 });
    expect(a.d90plus).toEqual({ amount: R(500), count: 1 });
    expect(a.notYetDue).toEqual({ amount: R(600), count: 1 });
    expect(a.total).toEqual({ amount: R(2_100), count: 6 });
  });
  it('uses the ORIGINAL due date even after the due date was extended; CURRENT basis uses the new one', () => {
    const r: Receivable = {
      ...mk({ id: 'x', no: 1, due: '2026-04-10', amount: R(100) }),
      dueDate: '2026-12-01',
    };
    expect(agingDays(r, '2026-10-08', 'ORIGINAL_DUE_DATE')).toBe(181);
    expect(computeAging([r], '2026-10-08', CFG).d90plus.amount).toBe(R(100));
    expect(agingDays(r, '2026-10-08', 'CURRENT_DUE_DATE')).toBe(-54);
    expect(
      computeAging([r], '2026-10-08', { ...CFG, agingBasis: 'CURRENT_DUE_DATE' }).notYetDue.amount,
    ).toBe(R(100));
  });
  it('paid, waived and void receivables are not aged', () => {
    const rs = [
      { ...mk({ id: 'p', no: 1, due: '2026-04-10', amount: R(100) }), pending: 0 },
      {
        ...mk({ id: 'v', no: 2, due: '2026-04-10', amount: R(100) }),
        paymentStatus: 'VOID' as const,
      },
    ];
    expect(computeAging(rs, '2026-10-08', CFG).total).toEqual({ amount: 0, count: 0 });
  });
  it('only the pending part is aged', () => {
    const r: Receivable = {
      ...mk({ id: 'x', no: 1, due: '2026-04-10', amount: R(1_000) }),
      pending: R(250),
    };
    expect(computeAging([r], '2026-10-08', CFG).d90plus.amount).toBe(R(250));
  });
});
