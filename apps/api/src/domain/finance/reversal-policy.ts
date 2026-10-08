import type { Paise } from '@sfm/shared';
import { FinanceError } from './errors';

export function assertReversalReason(reason: unknown): asserts reason is string {
  if (typeof reason !== 'string' || reason.trim().length < 3) {
    throw new FinanceError('REVERSAL_REASON_REQUIRED', 'A reason is required to reverse a payment.');
  }
}

/**
 * Optional second-level approval (BRC-E6). The threshold is a SYSTEM SETTING — no amount is
 * hard-coded; `null`/`undefined` means "no approval step" (the default).
 * Payments with amount >= threshold need a different user to approve.
 */
export function decideReversalApproval(input: {
  amount: Paise;
  thresholdPaise: Paise | null | undefined;
}): { approvalRequired: boolean } {
  const t = input.thresholdPaise;
  if (t === null || t === undefined) return { approvalRequired: false };
  if (!Number.isSafeInteger(t) || t <= 0) {
    throw new FinanceError('REVERSAL_APPROVER_INVALID', 'the reversal approval threshold setting is invalid', { threshold: t });
  }
  return { approvalRequired: input.amount >= t };
}

/** The approver must hold the approve permission and must not be the requester. */
export function assertValidApprover(input: {
  requesterId: string;
  approverId: string;
  approverHasPermission: boolean;
}): void {
  if (!input.approverHasPermission) {
    throw new FinanceError('REVERSAL_APPROVER_INVALID', 'This user is not allowed to approve reversals.');
  }
  if (input.approverId === input.requesterId) {
    throw new FinanceError('REVERSAL_APPROVER_INVALID', 'A reversal must be approved by a different user.');
  }
}
