import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  applyAllocations,
  applyReversal,
  assertAllocationConservation,
  assertReceivable,
  assertReversalReason,
  assertValidApprover,
  buildReversalAllocations,
  buildReversalReportRow,
  decideReversalApproval,
  isFullyReversed,
  netAllocated,
  type AllocationDraft,
  type PostedAllocation,
  type Receivable,
} from './index';
import { R, Y2026, catchFinance, mk } from '../../testing/fixtures';

const post = (drafts: AllocationDraft[], paymentId = 'pay-1', postingDate = '2026-10-08'): PostedAllocation[] =>
  drafts.map((d, i) => ({ ...d, id: `${paymentId}-a${i}`, paymentId, postingDate }));
const fresh = (): Receivable[] => [
  mk({ id: 'i1', no: 1, due: '2026-04-10', comps: { TUITION: R(4_000), TRANSPORT: R(1_000) } }),
  mk({ id: 'i2', no: 2, due: '2026-07-10', amount: R(15_000) }),
];
const shape = (rs: Receivable[]) => rs.map((r) => ({ id: r.id, paid: r.paid, pending: r.pending, status: r.paymentStatus, comps: r.components.map((c) => c.paid) }));

describe('payment reversal — compensating entries (BRC-E6)', () => {
  const original = fresh();
  const paid = allocatePayment({ amount: R(12_000), receivables: original, today: '2026-10-08', componentPriority: ['TRANSPORT'] });
  const rows = post(paid.allocations);

  it('creates one negative allocation per original allocation, linked to it; nothing is edited', () => {
    const reversal = buildReversalAllocations(rows);
    expect(reversal).toHaveLength(rows.length);
    reversal.forEach((r, i) => {
      expect(r.kind).toBe('REVERSAL');
      expect(r.amount).toBe(-(rows[i]?.amount ?? 0));
      expect(r.reversesAllocationId).toBe(rows[i]?.id);
      expect(r.componentSplit.every((s) => s.amount < 0)).toBe(true);
    });
    expect(rows.every((r) => r.kind === 'ALLOCATION' && r.amount > 0)).toBe(true); // originals untouched
    assertAllocationConservation(-R(12_000), reversal, 0);
  });

  it('restores every receivable and component exactly (statuses go back to unpaid/partial)', () => {
    const afterPay = paid.updatedReceivables;
    expect(afterPay[0]?.paymentStatus).toBe('PAID');
    const reopened = applyReversal(afterPay, buildReversalAllocations(rows));
    expect(shape(reopened)).toEqual(shape(original));
    reopened.forEach(assertReceivable);
    expect(reopened.map((r) => r.version)).toEqual([2, 2]); // pay (+1) and reverse (+1) — history is visible in the version
  });

  it('net allocated of the payment is zero after reversal', () => {
    const reversal = post(buildReversalAllocations(rows), 'pay-1', '2026-10-09');
    const all = [...rows, ...reversal];
    expect(netAllocated(rows)).toBe(R(12_000));
    expect(netAllocated(all)).toBe(0);
    expect(isFullyReversed(all)).toBe(true);
    expect(isFullyReversed(rows)).toBe(false);
  });

  it('a payment can only be reversed once', () => {
    const all = [...rows, ...post(buildReversalAllocations(rows), 'pay-1', '2026-10-09')];
    expect(catchFinance(() => buildReversalAllocations(all)).code).toBe('PAYMENT_ALREADY_REVERSED');
  });

  it('refuses to reverse a payment that has no allocations', () => {
    expect(catchFinance(() => buildReversalAllocations([])).code).toBe('ALLOCATION_INVALID');
  });

  it('reversal after other payments/adjustments keeps the later effects', () => {
    const second = allocatePayment({ amount: R(1_000), receivables: paid.updatedReceivables, today: '2026-10-08' });
    const reopened = applyReversal(second.updatedReceivables, buildReversalAllocations(rows));
    expect(reopened.reduce((s, r) => s + r.paid, 0)).toBe(R(1_000));
  });

  it('a reversal that would drive paid below zero is impossible (ledger corruption guard)', () => {
    expect(catchFinance(() => applyReversal(original, buildReversalAllocations(rows))).code).toBe('INVARIANT_VIOLATION');
  });

  it('the reversal report row carries original date/amount, reversal date/amount, reason and authorizer', () => {
    expect(
      buildReversalReportRow({
        payment: { paymentDate: '2026-10-08', amount: R(12_000), receiptNo: 'REC-2026-000001' },
        reversalDate: '2026-10-09', reversedAmount: R(12_000), reason: 'Entered against the wrong student', authorizedBy: 'accountant-1',
      }),
    ).toEqual({
      originalPaymentDate: '2026-10-08', originalAmount: R(12_000), reversalDate: '2026-10-09', reversedAmount: R(12_000),
      reason: 'Entered against the wrong student', authorizedBy: 'accountant-1', receiptNo: 'REC-2026-000001',
    });
  });
});

describe('reversal policy — reason, optional threshold approval, approver rules', () => {
  it('a reason is mandatory', () => {
    for (const bad of [undefined, null, '', '  ', 'ab', 42]) expect(catchFinance(() => assertReversalReason(bad)).code).toBe('REVERSAL_REASON_REQUIRED');
    expect(() => assertReversalReason('Wrong amount')).not.toThrow();
  });
  it('no threshold configured (default) → no second approval, whatever the amount', () => {
    expect(decideReversalApproval({ amount: R(10_000_000), thresholdPaise: null })).toEqual({ approvalRequired: false });
    expect(decideReversalApproval({ amount: R(10_000_000), thresholdPaise: undefined })).toEqual({ approvalRequired: false });
  });
  it('threshold from system settings: payments at or above it need approval', () => {
    expect(decideReversalApproval({ amount: R(49_999), thresholdPaise: R(50_000) })).toEqual({ approvalRequired: false });
    expect(decideReversalApproval({ amount: R(50_000), thresholdPaise: R(50_000) })).toEqual({ approvalRequired: true });
    expect(decideReversalApproval({ amount: R(80_000), thresholdPaise: R(50_000) })).toEqual({ approvalRequired: true });
  });
  it('an invalid threshold setting is an error, never silently "off"', () => {
    for (const t of [0, -5, 1.5]) expect(catchFinance(() => decideReversalApproval({ amount: 1, thresholdPaise: t })).code).toBe('REVERSAL_APPROVER_INVALID');
  });
  it('approver must hold the permission and differ from the requester', () => {
    expect(() => assertValidApprover({ requesterId: 'a', approverId: 'b', approverHasPermission: true })).not.toThrow();
    expect(catchFinance(() => assertValidApprover({ requesterId: 'a', approverId: 'a', approverHasPermission: true })).code).toBe('REVERSAL_APPROVER_INVALID');
    expect(catchFinance(() => assertValidApprover({ requesterId: 'a', approverId: 'b', approverHasPermission: false })).code).toBe('REVERSAL_APPROVER_INVALID');
  });
});

describe('PROPERTY — pay then reverse restores the receivables exactly', () => {
  it('for any set of dues and any payment amount', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ offset: fc.integer({ min: -200, max: 200 }), a: fc.integer({ min: 1, max: 3_000_000 }), b: fc.integer({ min: 0, max: 1_000_000 }) }), { minLength: 1, maxLength: 7 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (items, frac) => {
          const rs = items.map((it, i) => {
            const d = new Date(Date.UTC(2026, 9, 8) + it.offset * 86_400_000).toISOString().slice(0, 10);
            return mk({ id: `r${i}`, no: i + 1, due: d, comps: it.b > 0 ? { TUITION: it.a, LAB: it.b } : { TUITION: it.a }, year: Y2026 });
          });
          const total = rs.reduce((s, r) => s + r.pending, 0);
          const amount = Math.max(1, Math.floor(total * frac));
          const pay = allocatePayment({ amount, receivables: rs, today: '2026-10-08' });
          const back = applyAllocations(pay.updatedReceivables, buildReversalAllocations(post(pay.allocations)));
          expect(shape(back)).toEqual(shape(rs));
        },
      ),
      { numRuns: 200 },
    );
  });
});
