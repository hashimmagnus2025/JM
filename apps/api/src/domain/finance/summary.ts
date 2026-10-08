import { isAfter, isBefore, mulDivRound, type BusinessDate, type Paise } from '@sfm/shared';
import { FinanceError } from './errors';
import { deriveDueStatus } from './status';
import type { FinanceSettings, Receivable, ReceivableKind } from './types';

export interface KindTotals {
  payable: Paise;
  adjusted: Paise;
  transferred: Paise;
  paid: Paise;
  pending: Paise;
}

export interface NextInstallment {
  receivableId: string;
  label: string;
  installmentNo: number | undefined;
  dueDate: BusinessDate;
  pending: Paise;
}

/**
 * All metric definitions live here (decision register BRC-I1/I2). Everything is DERIVED from the
 * receivables; there is no stored/editable "current outstanding".
 */
export interface Summary {
  installments: KindTotals;
  openingBalance: KindTotals;
  penalties: KindTotals;
  adhoc: KindTotals;
  /** Σ payable of installments — "Applicable Fee"; never includes opening balance or penalties */
  grossFee: Paise;
  /** Σ adjusted of installments — approved discounts/concessions/scholarships/waivers */
  discounts: Paise;
  /** EXPECTED FEES = Σ(payable − adjusted) of installments (+ penalties only if configured). Opening balance excluded. */
  expectedFees: Paise;
  /** collected against the same receivables as `expectedFees` (so the % can never exceed 100) */
  collectedFees: Paise;
  /** COLLECTION % in basis points: collectedFees ÷ expectedFees (0 when expected = 0) */
  collectionBp: number;
  totalReceivable: Paise;
  totalPaid: Paise;
  totalTransferred: Paise;
  /** OUTSTANDING = Σ pending, always derived */
  totalOutstanding: Paise;
  overdue: Paise;
  dueSoon: Paise;
  notYetDue: Paise;
  nextInstallment: NextInstallment | null;
}

const zeroTotals = (): KindTotals => ({ payable: 0, adjusted: 0, transferred: 0, paid: 0, pending: 0 });

export function summarize(
  receivables: readonly Receivable[],
  today: BusinessDate,
  settings: Pick<FinanceSettings, 'dueSoonDays' | 'expectedIncludesPenalties'>,
): Summary {
  const kinds: Record<ReceivableKind, KindTotals> = {
    INSTALLMENT: zeroTotals(),
    OPENING_BALANCE: zeroTotals(),
    PENALTY: zeroTotals(),
    ADHOC: zeroTotals(),
  };
  let overdue = 0;
  let dueSoon = 0;
  let notYetDue = 0;
  let next: Receivable | null = null;

  for (const r of receivables) {
    if (r.paymentStatus === 'VOID') continue;
    const k = kinds[r.kind];
    k.payable += r.payable;
    k.adjusted += r.adjusted;
    k.transferred += r.transferred;
    k.paid += r.paid;
    k.pending += r.pending;
    const due = deriveDueStatus(r, today, settings.dueSoonDays);
    if (due === 'OVERDUE') overdue += r.pending;
    else if (due === 'DUE_SOON') dueSoon += r.pending;
    else if (due === 'NOT_DUE') notYetDue += r.pending;
    if (r.kind === 'INSTALLMENT' && r.pending > 0 && !isBefore(r.dueDate, today)) {
      if (
        next === null ||
        isBefore(r.dueDate, next.dueDate) ||
        (r.dueDate === next.dueDate && (r.installmentNo ?? 0) < (next.installmentNo ?? 0))
      ) {
        next = r;
      }
    }
  }

  const inst = kinds.INSTALLMENT;
  const pen = kinds.PENALTY;
  const withPen = settings.expectedIncludesPenalties;
  const expectedFees = inst.payable - inst.adjusted + (withPen ? pen.payable - pen.adjusted : 0);
  const collectedFees = inst.paid + (withPen ? pen.paid : 0);

  const all = Object.values(kinds);
  const sum = (f: (k: KindTotals) => number): number => all.reduce((s, k) => s + f(k), 0);
  const totalReceivable = sum((k) => k.payable - k.adjusted - k.transferred);
  const totalPaid = sum((k) => k.paid);
  const totalOutstanding = sum((k) => k.pending);
  if (totalOutstanding !== totalReceivable - totalPaid) {
    throw new FinanceError('INVARIANT_VIOLATION', 'outstanding does not equal receivable − paid', {
      totalOutstanding,
      totalReceivable,
      totalPaid,
    });
  }

  return {
    installments: inst,
    openingBalance: kinds.OPENING_BALANCE,
    penalties: pen,
    adhoc: kinds.ADHOC,
    grossFee: inst.payable,
    discounts: inst.adjusted,
    expectedFees,
    collectedFees,
    collectionBp: expectedFees === 0 ? 0 : mulDivRound(collectedFees, 10_000, expectedFees),
    totalReceivable,
    totalPaid,
    totalTransferred: sum((k) => k.transferred),
    totalOutstanding,
    overdue,
    dueSoon,
    notYetDue,
    nextInstallment: next
      ? {
          receivableId: (next as Receivable).id,
          label: (next as Receivable).label,
          installmentNo: (next as Receivable).installmentNo,
          dueDate: (next as Receivable).dueDate,
          pending: (next as Receivable).pending,
        }
      : null,
  };
}

export interface YearSummary {
  academicYearId: string;
  summary: Summary;
}

/**
 * BRC-D1: unpaid dues stay attached to their ORIGINAL academic year. Years are ordered by their
 * earliest original due date, so "2025-26 outstanding ₹10,000" and "2026-27 fee ₹50,000" appear separately.
 */
export function summarizeByAcademicYear(
  receivables: readonly Receivable[],
  today: BusinessDate,
  settings: Pick<FinanceSettings, 'dueSoonDays' | 'expectedIncludesPenalties'>,
): YearSummary[] {
  const groups = new Map<string, Receivable[]>();
  for (const r of receivables) {
    const list = groups.get(r.academicYearId) ?? [];
    list.push(r);
    groups.set(r.academicYearId, list);
  }
  const earliest = (rs: Receivable[]): BusinessDate =>
    rs.reduce((m, r) => (isAfter(m, r.originalDueDate) ? r.originalDueDate : m), rs[0]?.originalDueDate ?? '9999-12-31');
  return [...groups.entries()]
    .sort(([ka, a], [kb, b]) => {
      const ea = earliest(a);
      const eb = earliest(b);
      return ea < eb ? -1 : ea > eb ? 1 : ka < kb ? -1 : 1;
    })
    .map(([academicYearId, rs]) => ({ academicYearId, summary: summarize(rs, today, settings) }));
}

/** Cross-year total receivable (clearly NOT a replacement for the per-year view). */
export const summarizeAll = summarize;
