import {
  assertBusinessDate,
  assertPositivePaise,
  isBefore,
  type BusinessDate,
  type Paise,
} from '@sfm/shared';
import { FinanceError } from './errors';
import { newReceivable } from './receivable';
import { OPENING_BALANCE_COMPONENT, type Receivable } from './types';

export type OpeningBalanceSource = 'MIGRATION' | 'MANUAL' | 'ADMISSION' | 'CARRY_FORWARD';

export interface OpeningBalanceInput {
  /** id of the opening_balances document (deterministic dedupe key) */
  id: string;
  studentId: string;
  academicYearId: string;
  classId?: string;
  divisionId?: string;
  amount: Paise;
  effectiveDate: BusinessDate;
  /** defaults to effectiveDate — also the aging basis (BRC-I2) */
  dueDate?: BusinessDate;
  source: OpeningBalanceSource;
  reason: string;
}

export const openingBalanceDedupeKey = (openingBalanceId: string): string =>
  `OPENING_BALANCE:${openingBalanceId}`;

export interface OpeningBalanceContext {
  /** an ACTIVE opening balance already exists for this student + academic year */
  existingActive: boolean;
  academicYear?: { startDate: BusinessDate; endDate: BusinessDate };
}

export function validateOpeningBalance(
  input: OpeningBalanceInput,
  ctx: OpeningBalanceContext,
): void {
  const bad = (msg: string, details?: Record<string, unknown>): never => {
    throw new FinanceError('OPENING_BALANCE_INVALID', msg, details);
  };
  if (ctx.existingActive) {
    throw new FinanceError(
      'OPENING_BALANCE_DUPLICATE',
      'This student already has an opening balance for the academic year. Reverse it first to correct it.',
      { studentId: input.studentId, academicYearId: input.academicYearId },
    );
  }
  try {
    assertPositivePaise(input.amount, 'opening balance');
  } catch {
    bad('Opening balance must be greater than zero.');
  }
  assertBusinessDate(input.effectiveDate, 'effective date');
  if (input.dueDate !== undefined) {
    assertBusinessDate(input.dueDate, 'due date');
    if (isBefore(input.dueDate, input.effectiveDate))
      bad('Due date cannot be before the effective date.');
  }
  if (input.reason.trim().length < 3) bad('A reason is required for an opening balance.');
  if (ctx.academicYear && isBefore(ctx.academicYear.endDate, input.effectiveDate)) {
    bad('Effective date is after the end of the academic year.');
  }
}

/**
 * An opening balance becomes exactly ONE receivable of kind OPENING_BALANCE with the system
 * component OPENING_BALANCE. It is never part of the year's gross fee (decision: BRC-D1 / #2).
 */
export function buildOpeningBalanceReceivable(
  input: OpeningBalanceInput,
  ctx: OpeningBalanceContext,
  idFactory: (dedupeKey: string) => string = (k) => k,
): Receivable {
  validateOpeningBalance(input, ctx);
  const key = openingBalanceDedupeKey(input.id);
  return newReceivable({
    id: idFactory(key),
    studentId: input.studentId,
    academicYearId: input.academicYearId,
    classId: input.classId,
    divisionId: input.divisionId,
    kind: 'OPENING_BALANCE',
    label: 'Opening balance',
    dueDate: input.dueDate ?? input.effectiveDate,
    components: [
      { code: OPENING_BALANCE_COMPONENT, name: 'Opening balance', payable: input.amount },
    ],
    dedupeKey: key,
  });
}
