import { businessDateFromInstant, parseAcademicYearLabel, type BusinessDate } from '@sfm/shared';
import { FinanceError } from './errors';

export type ReceiptScope = 'ACADEMIC_YEAR' | 'CALENDAR_YEAR' | 'FINANCIAL_YEAR' | 'NONE';

export interface ReceiptNumbering {
  /** default 'REC' */
  prefix: string;
  scope: ReceiptScope;
  /** zero-padding width, default 6 */
  pad: number;
}

export const DEFAULT_RECEIPT_NUMBERING: ReceiptNumbering = { prefix: 'REC', scope: 'ACADEMIC_YEAR', pad: 6 };

export function validateReceiptNumbering(n: ReceiptNumbering): void {
  if (!/^[A-Z0-9]{1,10}$/.test(n.prefix)) {
    throw new FinanceError('RECEIPT_NUMBER_INVALID', 'receipt prefix must be 1–10 upper-case letters or digits');
  }
  if (!Number.isInteger(n.pad) || n.pad < 4 || n.pad > 10) {
    throw new FinanceError('RECEIPT_NUMBER_INVALID', 'receipt number padding must be between 4 and 10');
  }
}

/**
 * Year part of the receipt number (CL-08):
 *  ACADEMIC_YEAR  start year of the academic year containing the payment date   (2026-27 → 2026)
 *  CALENDAR_YEAR  calendar year of the payment date
 *  FINANCIAL_YEAR start year of the Apr–Mar financial year containing the payment date
 *  NONE           one global series
 */
export function receiptScopeKey(
  scope: ReceiptScope,
  ctx: { paymentDate: BusinessDate; academicYearLabel?: string },
): string {
  const year = Number(ctx.paymentDate.slice(0, 4));
  const month = Number(ctx.paymentDate.slice(5, 7));
  switch (scope) {
    case 'NONE':
      return '';
    case 'CALENDAR_YEAR':
      return String(year);
    case 'FINANCIAL_YEAR':
      return String(month >= 4 ? year : year - 1);
    case 'ACADEMIC_YEAR':
      if (!ctx.academicYearLabel) {
        throw new FinanceError('RECEIPT_NUMBER_INVALID', 'an academic year is required to number this receipt');
      }
      return String(parseAcademicYearLabel(ctx.academicYearLabel).startYear);
  }
}

/** key of the sequence counter — one independent sequence per prefix + scope year */
export const receiptCounterKey = (prefix: string, scopeKey: string): string => `receipt:${prefix}:${scopeKey || 'all'}`;

/** REC-2026-000001 (scope NONE → REC-000001). Sequence numbers never repeat; gaps are allowed (BRC-G1). */
export function formatReceiptNumber(numbering: ReceiptNumbering, scopeKey: string, seq: number): string {
  validateReceiptNumbering(numbering);
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new FinanceError('RECEIPT_NUMBER_INVALID', 'receipt sequence must be a positive integer');
  }
  const body = String(seq).padStart(numbering.pad, '0');
  return scopeKey ? `${numbering.prefix}-${scopeKey}-${body}` : `${numbering.prefix}-${body}`;
}

/** Convenience for callers holding an instant instead of a business date. */
export const paymentDateOf = (instant: Date): BusinessDate => businessDateFromInstant(instant);
