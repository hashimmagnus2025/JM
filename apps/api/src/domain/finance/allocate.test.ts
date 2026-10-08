import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocatePayment, applyAllocations, assertReceivable, compareOldestDueFirst, orderReceivables, splitByComponentPriority, type Receivable, type ReceivableKind } from './index';
import { R, Y2025, Y2026, catchFinance, deepFreeze, mk } from '../../testing/fixtures';

const TODAY = '2026-10-08';

describe('allocation order — OLDEST_DUE_FIRST (BRC-E1)', () => {
  it('pays the oldest overdue receivable first regardless of input order', () => {
    const rs = deepFreeze([
      mk({ id: 'i3', no: 3, due: '2026-10-10', amount: R(1_000) }),
      mk({ id: 'i2', no: 2, due: '2026-07-10', amount: R(1_000) }),
      mk({ id: 'i1', no: 1, due: '2026-04-10', amount: R(1_000) }),
    ]);
    const res = allocatePayment({ amount: R(1_500), receivables: rs, today: TODAY });
    expect(res.allocations.map((a) => [a.receivableId, a.amount])).toEqual([['i1', R(1_000)], ['i2', R(500)]]);
  });

  it('overdue tier: oldest due date wins, then opening balance → penalty → installment on equal dates', () => {
    const rs = [
      mk({ id: 'inst', no: 1, due: '2026-04-10', amount: R(100) }),
      mk({ id: 'pen', kind: 'PENALTY', due: '2026-04-10', amount: R(100), parent: 'inst', periodKey: 'ONCE' }),
      mk({ id: 'ob', kind: 'OPENING_BALANCE', due: '2026-04-10', amount: R(100) }),
      mk({ id: 'older', no: 9, due: '2026-03-01', amount: R(100) }),
    ];
    expect(orderReceivables(rs, 'OLDEST_DUE_FIRST', TODAY).map((r) => r.id)).toEqual(['older', 'ob', 'pen', 'inst']);
  });

  it('a recent overdue penalty ranks after older overdue installments (it ranks by its own due date, CL-01)', () => {
    const rs = [
      mk({ id: 'pen', kind: 'PENALTY', due: '2026-10-01', amount: R(100), parent: 'i1', periodKey: 'D:2026-10-01' }),
      mk({ id: 'i2', no: 2, due: '2026-07-10', amount: R(100) }),
      mk({ id: 'i1', no: 1, due: '2026-04-10', amount: R(100) }),
    ];
    expect(orderReceivables(rs, 'OLDEST_DUE_FIRST', TODAY).map((r) => r.id)).toEqual(['i1', 'i2', 'pen']);
  });

  it('not-yet-overdue tier: opening balance → penalty → oldest installment → newer installments', () => {
    const rs = [
      mk({ id: 'i4', no: 4, due: '2027-01-10', amount: R(100) }),
      mk({ id: 'i3', no: 3, due: '2026-10-10', amount: R(100) }),
      mk({ id: 'pen', kind: 'PENALTY', due: '2026-12-01', amount: R(100), parent: 'i3', periodKey: 'ONCE' }),
      mk({ id: 'ob', kind: 'OPENING_BALANCE', due: '2026-12-31', amount: R(100) }),
    ];
    expect(orderReceivables(rs, 'OLDEST_DUE_FIRST', TODAY).map((r) => r.id)).toEqual(['ob', 'pen', 'i3', 'i4']);
  });

  it('overdue items always rank before not-yet-due items', () => {
    const rs = [
      mk({ id: 'ob-future', kind: 'OPENING_BALANCE', due: '2026-12-31', amount: R(100) }),
      mk({ id: 'i-overdue', no: 1, due: '2026-10-07', amount: R(100) }),
    ];
    expect(orderReceivables(rs, 'OLDEST_DUE_FIRST', TODAY).map((r) => r.id)).toEqual(['i-overdue', 'ob-future']);
  });

  it('prior-year dues are paid before current-year installments (oldest first), each keeping its own year', () => {
    const rs = [
      mk({ id: 'cur', no: 1, due: '2026-04-10', amount: R(50_000), year: Y2026 }),
      mk({ id: 'old', no: 4, due: '2026-01-10', amount: R(10_000), year: Y2025 }),
    ];
    const res = allocatePayment({ amount: R(12_000), receivables: rs, today: TODAY });
    expect(res.allocations.map((a) => [a.receivableId, a.academicYearId, a.amount])).toEqual([
      ['old', Y2025, R(10_000)],
      ['cur', Y2026, R(2_000)],
    ]);
  });

  it('tie-breaks deterministically by installment number then id', () => {
    const a = mk({ id: 'b', no: 2, due: '2026-04-10', amount: R(1) });
    const b = mk({ id: 'a', no: 2, due: '2026-04-10', amount: R(1) });
    const c = mk({ id: 'z', no: 1, due: '2026-04-10', amount: R(1) });
    expect(orderReceivables([a, b, c], 'OLDEST_DUE_FIRST', TODAY).map((r) => r.id)).toEqual(['z', 'a', 'b']);
    expect(compareOldestDueFirst(TODAY)(a, a)).toBe(0);
  });

  it('rejects an unknown automatic strategy', () => {
    expect(catchFinance(() => orderReceivables([], 'MANUAL', TODAY)).code).toBe('ALLOCATION_INVALID');
  });
});

describe('payment amounts', () => {
  const rs = [mk({ id: 'i1', no: 1, due: '2026-04-10', amount: R(1_000) })];

  it('zero amount is rejected', () => {
    const e = catchFinance(() => allocatePayment({ amount: 0, receivables: rs, today: TODAY }));
    expect(e).toMatchObject({ code: 'PAYMENT_AMOUNT_INVALID', details: { reason: 'ZERO' } });
  });
  it('negative and fractional amounts are rejected', () => {
    expect(catchFinance(() => allocatePayment({ amount: -5, receivables: rs, today: TODAY })).details).toMatchObject({ reason: 'NEGATIVE' });
    expect(catchFinance(() => allocatePayment({ amount: 10.5, receivables: rs, today: TODAY })).details).toMatchObject({ reason: 'NOT_INTEGER' });
  });
  it('full payment closes the receivable', () => {
    const res = allocatePayment({ amount: R(1_000), receivables: rs, today: TODAY });
    expect(res.updatedReceivables[0]).toMatchObject({ pending: 0, paid: R(1_000), paymentStatus: 'PAID' });
    expect(res.unallocated).toBe(0);
  });
  it('partial payment leaves a partially paid receivable', () => {
    const res = allocatePayment({ amount: R(400), receivables: rs, today: TODAY });
    expect(res.updatedReceivables[0]).toMatchObject({ pending: R(600), paymentStatus: 'PARTIAL' });
  });
  it('OVERPAYMENT is rejected with the outstanding amount (advance disabled by default)', () => {
    const e = catchFinance(() => allocatePayment({ amount: R(1_001), receivables: rs, today: TODAY }));
    expect(e).toMatchObject({ code: 'PAYMENT_EXCEEDS_OUTSTANDING', details: { amount: R(1_001), outstanding: R(1_000) } });
  });
  it('overpayment becomes advance credit only when advance payments are enabled (BRC-E2)', () => {
    const res = allocatePayment({ amount: R(1_300), receivables: rs, today: TODAY, advanceEnabled: true });
    expect(res.unallocated).toBe(R(300));
    expect(res.allocations[0]?.amount).toBe(R(1_000));
    expect(res.updatedReceivables[0]?.paymentStatus).toBe('PAID');
  });
  it('nothing outstanding → NO_PAYABLE_RECEIVABLES (or pure advance when enabled)', () => {
    const paid = allocatePayment({ amount: R(1_000), receivables: rs, today: TODAY }).updatedReceivables;
    expect(catchFinance(() => allocatePayment({ amount: R(1), receivables: paid, today: TODAY })).code).toBe('NO_PAYABLE_RECEIVABLES');
    const adv = allocatePayment({ amount: R(5), receivables: paid, today: TODAY, advanceEnabled: true });
    expect(adv).toMatchObject({ allocations: [], unallocated: R(5) });
  });
  it('void, waived and transferred receivables never receive money', () => {
    const void1 = { ...mk({ id: 'v', no: 1, due: '2026-04-10', amount: R(100) }), paymentStatus: 'VOID' as const };
    const waived = { ...mk({ id: 'w', no: 2, due: '2026-04-11', amount: R(100) }), paymentStatus: 'WAIVED' as const };
    const live = mk({ id: 'l', no: 3, due: '2026-05-01', amount: R(100) });
    const res = allocatePayment({ amount: R(100), receivables: [void1, waived, live], today: TODAY });
    expect(res.allocations.map((a) => a.receivableId)).toEqual(['l']);
  });
  it('AUTO allocation can be restricted to the dues the cashier selected', () => {
    const two = [mk({ id: 'a', no: 1, due: '2026-04-10', amount: R(100) }), mk({ id: 'b', no: 2, due: '2026-07-10', amount: R(100) })];
    const res = allocatePayment({ amount: R(100), receivables: two, today: TODAY, eligibleReceivableIds: ['b'] });
    expect(res.allocations.map((a) => a.receivableId)).toEqual(['b']);
    expect(catchFinance(() => allocatePayment({ amount: R(101), receivables: two, today: TODAY, eligibleReceivableIds: ['b'] })).code).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
  });
  it('never mutates its inputs', () => {
    const frozen = deepFreeze([mk({ id: 'a', no: 1, due: '2026-04-10', amount: R(100) })]);
    expect(() => allocatePayment({ amount: R(40), receivables: frozen, today: TODAY })).not.toThrow();
    expect(frozen[0]?.paid).toBe(0);
  });
});

describe('component priority inside a receivable (BRC-E1)', () => {
  const r = mk({ id: 'c', no: 1, due: '2026-04-10', comps: { TUITION: R(600), TRANSPORT: R(300), LIBRARY: R(100) } });
  it('follows the configured priority; unlisted components follow in their own order', () => {
    const split = splitByComponentPriority(r, R(750), ['LIBRARY', 'TRANSPORT']);
    expect(split).toEqual([
      { componentCode: 'LIBRARY', amount: R(100) },
      { componentCode: 'TRANSPORT', amount: R(300) },
      { componentCode: 'TUITION', amount: R(350) },
    ]);
  });
  it('without a priority list, components are paid in the receivable order', () => {
    expect(splitByComponentPriority(r, R(700), [])).toEqual([
      { componentCode: 'TUITION', amount: R(600) },
      { componentCode: 'TRANSPORT', amount: R(100) },
    ]);
  });
  it('refuses more than the pending balance', () => {
    expect(catchFinance(() => splitByComponentPriority(r, R(1_001), [])).code).toBe('ALLOCATION_INVALID');
  });
  it('a later payment continues from where the previous one stopped (partially-paid component)', () => {
    const first = allocatePayment({ amount: R(150), receivables: [r], today: TODAY, componentPriority: ['LIBRARY', 'TRANSPORT'] });
    const second = allocatePayment({ amount: R(100), receivables: first.updatedReceivables, today: TODAY, componentPriority: ['LIBRARY', 'TRANSPORT'] });
    expect(second.allocations[0]?.componentSplit).toEqual([{ componentCode: 'TRANSPORT', amount: R(100) }]);
    const left = second.updatedReceivables[0];
    expect(left?.components.find((c) => c.code === 'LIBRARY')?.paid).toBe(R(100));
    expect(left?.components.find((c) => c.code === 'TRANSPORT')?.paid).toBe(R(150));
  });
});

describe('MANUAL allocation (permission-gated)', () => {
  const rs = [
    mk({ id: 'a', no: 1, due: '2026-04-10', amount: R(500) }),
    mk({ id: 'b', no: 2, due: '2026-07-10', amount: R(500) }),
  ];
  it('allocates exactly as instructed', () => {
    const res = allocatePayment({ amount: R(300), receivables: rs, today: TODAY, strategy: 'MANUAL', manual: [{ receivableId: 'b', amount: R(300) }] });
    expect(res.strategy).toBe('MANUAL');
    expect(res.updatedReceivables.map((r) => r.pending)).toEqual([R(500), R(200)]);
  });
  it('validates the instruction', () => {
    const run = (manual: { receivableId: string; amount: number }[], amount = R(300), advanceEnabled = false) =>
      catchFinance(() => allocatePayment({ amount, receivables: rs, today: TODAY, strategy: 'MANUAL', manual, advanceEnabled })).code;
    expect(run([])).toBe('ALLOCATION_INVALID');
    expect(run([{ receivableId: 'a', amount: R(100) }, { receivableId: 'a', amount: R(100) }])).toBe('ALLOCATION_INVALID');
    expect(run([{ receivableId: 'zzz', amount: R(100) }])).toBe('ALLOCATION_INVALID');
    expect(run([{ receivableId: 'a', amount: R(501) }], R(501))).toBe('ALLOCATION_INVALID');
    expect(run([{ receivableId: 'a', amount: R(400) }], R(300))).toBe('ALLOCATION_INVALID'); // more than paid in
    expect(run([{ receivableId: 'a', amount: R(100) }], R(300))).toBe('ALLOCATION_INCOMPLETE'); // part of the payment left over
    expect(run([{ receivableId: 'a', amount: 0 }])).toBe('PAYMENT_AMOUNT_INVALID');
    expect(
      allocatePayment({ amount: R(300), receivables: rs, today: TODAY, strategy: 'MANUAL', manual: [{ receivableId: 'a', amount: R(100) }], advanceEnabled: true }).unallocated,
    ).toBe(R(200));
  });
});

describe('applyAllocations safety net', () => {
  const r = mk({ id: 'a', no: 1, due: '2026-04-10', amount: R(100) });
  const draft = (amount: number, code = 'TUITION', id = 'a') => ({
    receivableId: id, studentId: 's', academicYearId: Y2026, kind: 'ALLOCATION' as const, amount, componentSplit: [{ componentCode: code, amount }],
  });
  it('rejects unknown receivables/components, over-allocation and negative paid', () => {
    expect(catchFinance(() => applyAllocations([r], [draft(10, 'TUITION', 'nope')])).code).toBe('ALLOCATION_INVALID');
    expect(catchFinance(() => applyAllocations([r], [draft(10, 'NOPE')])).code).toBe('ALLOCATION_INVALID');
    expect(catchFinance(() => applyAllocations([r], [draft(R(100) + 1)])).code).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
    expect(catchFinance(() => applyAllocations([r], [draft(-1)])).code).toBe('INVARIANT_VIOLATION');
  });
  it('bumps the version once per touched receivable and leaves others untouched', () => {
    const other = mk({ id: 'o', no: 2, due: '2026-05-10', amount: R(10) });
    const out = applyAllocations([r, other], [draft(10), draft(5)]);
    expect(out[0]?.version).toBe(1);
    expect(out[0]?.paid).toBe(15);
    expect(out[1]).toBe(other);
  });
});

describe('PROPERTY — allocation conserves money and respects the order', () => {
  const kinds: ReceivableKind[] = ['INSTALLMENT', 'OPENING_BALANCE', 'PENALTY'];
  const receivableArb = fc
    .array(
      fc.record({
        kind: fc.constantFrom(...kinds),
        dueOffset: fc.integer({ min: -300, max: 300 }),
        amount: fc.integer({ min: 1, max: 5_000_000 }),
        year: fc.constantFrom(Y2025, Y2026),
      }),
      { minLength: 1, maxLength: 9 },
    )
    .map((items): Receivable[] =>
      items.map((it, i) => {
        const d = new Date(Date.UTC(2026, 9, 8) + it.dueOffset * 86_400_000).toISOString().slice(0, 10);
        return mk({ id: `r${i}`, kind: it.kind, no: it.kind === 'INSTALLMENT' ? i + 1 : undefined, due: d, amount: it.amount, year: it.year });
      }),
    );

  it('Σ allocations = amount; every invariant holds; nothing negative; ordering respected', () => {
    fc.assert(
      fc.property(receivableArb, fc.double({ min: 0, max: 1, noNaN: true }), (rs, frac) => {
        const total = rs.reduce((s, r) => s + r.pending, 0);
        const amount = Math.max(1, Math.floor(total * frac));
        const res = allocatePayment({ amount, receivables: rs, today: TODAY });
        expect(res.allocations.reduce((s, a) => s + a.amount, 0)).toBe(amount);
        expect(res.unallocated).toBe(0);
        res.updatedReceivables.forEach(assertReceivable);
        expect(res.updatedReceivables.reduce((s, r) => s + r.pending, 0)).toBe(total - amount);

        // priority: once a receivable is only partly paid, nothing ranked after it received money
        const ordered = orderReceivables(rs, 'OLDEST_DUE_FIRST', TODAY);
        const got = new Map(res.allocations.map((a) => [a.receivableId, a.amount]));
        let sawUnfinished = false;
        for (const r of ordered) {
          const a = got.get(r.id) ?? 0;
          if (sawUnfinished) expect(a).toBe(0);
          if (a < r.pending) sawUnfinished = true;
        }
      }),
      { numRuns: 300 },
    );
  });
});
