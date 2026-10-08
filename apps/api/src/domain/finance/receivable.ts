import {
  addPaise,
  assertNonNegativePaise,
  sumPaise,
  type BusinessDate,
  type Paise,
} from '@sfm/shared';
import { FinanceError } from './errors';
import type { ComponentBalance, Receivable, ReceivableKind, ReceivableStatus } from './types';

/** Stored status derived from the amounts (VOID is sticky). */
export function deriveStoredStatus(
  r: Pick<Receivable, 'paymentStatus' | 'pending' | 'paid' | 'transferred'>,
): ReceivableStatus {
  if (r.paymentStatus === 'VOID') return 'VOID';
  if (r.pending === 0) {
    if (r.transferred > 0) return 'TRANSFERRED';
    return r.paid > 0 ? 'PAID' : 'WAIVED';
  }
  return r.paid > 0 ? 'PARTIAL' : 'UNPAID';
}

/** Component-level pending. */
export const componentPending = (c: ComponentBalance): Paise =>
  c.payable - c.adjusted - c.transferred - c.paid;

/**
 * Recompute every aggregate of a receivable from its components (single source of truth)
 * and re-derive pending + stored status. Returns a NEW object.
 */
export function recompute(r: Receivable): Receivable {
  const components = r.components.map((c) => ({ ...c }));
  const payable = sumPaise(components.map((c) => c.payable));
  const adjusted = sumPaise(components.map((c) => c.adjusted));
  const transferred = sumPaise(components.map((c) => c.transferred));
  const paid = sumPaise(components.map((c) => c.paid));
  const pending = payable - adjusted - transferred - paid;
  const next: Receivable = { ...r, components, payable, adjusted, transferred, paid, pending };
  next.paymentStatus = deriveStoredStatus(next);
  return next;
}

export interface NewReceivableInit {
  id: string;
  studentId: string;
  academicYearId: string;
  classId?: string | undefined;
  divisionId?: string | undefined;
  kind: ReceivableKind;
  label: string;
  installmentNo?: number | undefined;
  dueDate: BusinessDate;
  parentReceivableId?: string | undefined;
  periodKey?: string | undefined;
  components: { code: string; name: string; payable: Paise }[];
  dedupeKey: string;
}

/** Build a fresh, unpaid receivable. */
export function newReceivable(init: NewReceivableInit): Receivable {
  if (init.components.length === 0) {
    throw new FinanceError('INVARIANT_VIOLATION', 'a receivable needs at least one component');
  }
  const seen = new Set<string>();
  for (const c of init.components) {
    assertNonNegativePaise(c.payable, `component ${c.code}`);
    if (seen.has(c.code))
      throw new FinanceError('INVARIANT_VIOLATION', `duplicate component ${c.code}`);
    seen.add(c.code);
  }
  const base: Receivable = {
    id: init.id,
    studentId: init.studentId,
    academicYearId: init.academicYearId,
    kind: init.kind,
    label: init.label,
    dueDate: init.dueDate,
    originalDueDate: init.dueDate,
    components: init.components.map((c) => ({
      code: c.code,
      name: c.name,
      payable: c.payable,
      adjusted: 0,
      transferred: 0,
      paid: 0,
    })),
    payable: 0,
    adjusted: 0,
    transferred: 0,
    paid: 0,
    pending: 0,
    paymentStatus: 'UNPAID',
    hasPendingAdjustment: false,
    dedupeKey: init.dedupeKey,
    version: 0,
  };
  if (init.classId !== undefined) base.classId = init.classId;
  if (init.divisionId !== undefined) base.divisionId = init.divisionId;
  if (init.installmentNo !== undefined) base.installmentNo = init.installmentNo;
  if (init.parentReceivableId !== undefined) base.parentReceivableId = init.parentReceivableId;
  if (init.periodKey !== undefined) base.periodKey = init.periodKey;
  return recompute(base);
}

/** Outstanding of a set of receivables — ALWAYS derived, never stored as truth (decision #3/#4). */
export function totalPending(receivables: readonly Receivable[]): Paise {
  return receivables.reduce((s, r) => (r.paymentStatus === 'VOID' ? s : addPaise(s, r.pending)), 0);
}

/** Receivables that can still receive a payment. */
export const isPayable = (r: Receivable): boolean =>
  r.pending > 0 &&
  r.paymentStatus !== 'VOID' &&
  r.paymentStatus !== 'WAIVED' &&
  r.paymentStatus !== 'TRANSFERRED';
