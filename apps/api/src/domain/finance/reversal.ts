import type { BusinessDate, Paise } from '@sfm/shared';
import { FinanceError } from './errors';
import { applyAllocations } from './allocate';
import type { AllocationDraft, PostedAllocation, Receivable } from './types';

/** Net amount currently allocated by a payment (allocations + their reversals). */
export const netAllocated = (rows: readonly Pick<PostedAllocation, 'amount'>[]): Paise =>
  rows.reduce((s, r) => s + r.amount, 0);

export const isFullyReversed = (rows: readonly PostedAllocation[]): boolean =>
  rows.some((r) => r.kind === 'REVERSAL') && netAllocated(rows) === 0;

/**
 * Compensating entries for a full reversal (decision BRC-E6, CL-06): one NEGATIVE allocation per
 * original allocation, linked through `reversesAllocationId`. Nothing is edited or deleted.
 */
export function buildReversalAllocations(rows: readonly PostedAllocation[]): AllocationDraft[] {
  if (rows.length === 0) {
    throw new FinanceError('ALLOCATION_INVALID', 'the payment has no allocations to reverse');
  }
  if (rows.some((r) => r.kind === 'REVERSAL')) {
    throw new FinanceError('PAYMENT_ALREADY_REVERSED', 'This payment has already been reversed.');
  }
  return rows.map((r) => ({
    receivableId: r.receivableId,
    studentId: r.studentId,
    academicYearId: r.academicYearId,
    kind: 'REVERSAL' as const,
    amount: -r.amount,
    componentSplit: r.componentSplit.map((s) => ({ componentCode: s.componentCode, amount: -s.amount })),
    reversesAllocationId: r.id,
  }));
}

/** Re-open the receivables touched by the original payment. */
export function applyReversal(receivables: readonly Receivable[], reversal: readonly AllocationDraft[]): Receivable[] {
  return applyAllocations(receivables, reversal);
}

export interface ReversalReportRow {
  originalPaymentDate: BusinessDate;
  originalAmount: Paise;
  reversalDate: BusinessDate;
  reversedAmount: Paise;
  reason: string;
  authorizedBy: string;
  receiptNo: string;
}

/** Row of the Reversal Report: original date/amount · reversal date/amount · reason · authorized by. */
export function buildReversalReportRow(input: {
  payment: { paymentDate: BusinessDate; amount: Paise; receiptNo: string };
  reversalDate: BusinessDate;
  reversedAmount: Paise;
  reason: string;
  /** approver when an approval step happened, otherwise the user who performed the reversal (CL-07) */
  authorizedBy: string;
}): ReversalReportRow {
  return {
    originalPaymentDate: input.payment.paymentDate,
    originalAmount: input.payment.amount,
    reversalDate: input.reversalDate,
    reversedAmount: input.reversedAmount,
    reason: input.reason,
    authorizedBy: input.authorizedBy,
    receiptNo: input.payment.receiptNo,
  };
}
