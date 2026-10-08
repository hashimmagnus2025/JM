import { addDays, isAfter, isBefore, type BusinessDate, type Paise } from '@sfm/shared';
import { totalPending } from './receivable';
import type { Receivable } from './types';

/** Time-dependent state; never stored. */
export type DueStatus = 'NOT_DUE' | 'DUE_SOON' | 'OVERDUE' | 'NONE';

export type PaymentState = 'UNPAID' | 'PARTIAL' | 'PAID' | 'PENDING_ADJUSTMENT' | 'WAIVED' | 'TRANSFERRED' | 'VOID';

/**
 * DUE SOON (BRC-I1): `dueSoonDays` (default 7) before the due date, up to and including the due date.
 * OVERDUE: due date strictly before today. Only receivables with something pending have a due status.
 */
export function deriveDueStatus(
  r: Pick<Receivable, 'pending' | 'dueDate' | 'paymentStatus'>,
  today: BusinessDate,
  dueSoonDays: number,
): DueStatus {
  if (r.paymentStatus === 'VOID' || r.pending <= 0) return 'NONE';
  if (isBefore(r.dueDate, today)) return 'OVERDUE';
  if (!isAfter(today, r.dueDate) && !isBefore(today, addDays(r.dueDate, -dueSoonDays))) return 'DUE_SOON';
  return 'NOT_DUE';
}

/**
 * Receivable-level payment state (BRC-I1):
 *   PAID = remaining balance is zero AND no active pending adjustment on the receivable.
 *   Zero balance with a pending adjustment is PENDING_ADJUSTMENT (CL-09), never PAID.
 */
export function derivePaymentState(r: Receivable): PaymentState {
  if (r.paymentStatus === 'VOID') return 'VOID';
  if (r.pending === 0) {
    if (r.hasPendingAdjustment) return 'PENDING_ADJUSTMENT';
    if (r.paymentStatus === 'TRANSFERRED') return 'TRANSFERRED';
    if (r.paymentStatus === 'WAIVED') return 'WAIVED';
    return 'PAID';
  }
  return r.paid > 0 ? 'PARTIAL' : 'UNPAID';
}

export interface ReceivableDisplayStatus {
  payment: PaymentState;
  due: DueStatus;
  /** the single badge to show: overdue > due soon > payment state */
  primary: 'OVERDUE' | 'DUE_SOON' | PaymentState;
}

export function deriveDisplayStatus(r: Receivable, today: BusinessDate, dueSoonDays: number): ReceivableDisplayStatus {
  const payment = derivePaymentState(r);
  const due = deriveDueStatus(r, today, dueSoonDays);
  const primary = due === 'OVERDUE' ? 'OVERDUE' : due === 'DUE_SOON' ? 'DUE_SOON' : payment;
  return { payment, due, primary };
}

/**
 * FULLY SETTLED (BRC-I1): the complete financial obligation of the given scope is cleared.
 * The caller chooses the scope by filtering receivables: one academic year, or all years.
 * An empty scope has no obligation → not "settled" (nothing to settle).
 */
export function isFullySettled(receivables: readonly Receivable[]): boolean {
  const live = receivables.filter((r) => r.paymentStatus !== 'VOID');
  return live.length > 0 && live.every((r) => r.pending === 0 && !r.hasPendingAdjustment);
}

export interface ScopeState {
  paymentState: 'NONE' | 'UNPAID' | 'PARTIAL' | 'PAID';
  fullySettled: boolean;
  pending: Paise;
  hasOverdue: boolean;
  hasDueSoon: boolean;
  /** time-independent; "overdue" ⇔ earliestPendingDueDate < today (evaluated at query time) */
  earliestPendingDueDate: BusinessDate | null;
}

/** Student(-year) level state used by lists and dashboard buckets. Overdue is an overlay, not a bucket. */
export function deriveScopeState(receivables: readonly Receivable[], today: BusinessDate, dueSoonDays: number): ScopeState {
  const live = receivables.filter((r) => r.paymentStatus !== 'VOID');
  const pending = totalPending(live);
  const paidAny = live.some((r) => r.paid > 0);
  let earliest: BusinessDate | null = null;
  let hasOverdue = false;
  let hasDueSoon = false;
  for (const r of live) {
    if (r.pending <= 0) continue;
    if (earliest === null || isBefore(r.dueDate, earliest)) earliest = r.dueDate;
    const due = deriveDueStatus(r, today, dueSoonDays);
    if (due === 'OVERDUE') hasOverdue = true;
    if (due === 'DUE_SOON') hasDueSoon = true;
  }
  const paymentState: ScopeState['paymentState'] =
    live.length === 0 ? 'NONE' : pending === 0 ? 'PAID' : paidAny ? 'PARTIAL' : 'UNPAID';
  return {
    paymentState,
    fullySettled: isFullySettled(live),
    pending,
    hasOverdue,
    hasDueSoon,
    earliestPendingDueDate: earliest,
  };
}
