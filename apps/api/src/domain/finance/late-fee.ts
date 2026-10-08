import {
  addDays,
  dateRange,
  isAfter,
  isBefore,
  maxDate,
  minDate,
  percentBp,
  type BusinessDate,
  type Paise,
} from '@sfm/shared';
import { FinanceError } from './errors';
import { newReceivable } from './receivable';
import { LATE_FEE_COMPONENT, type Receivable, type ReceivableKind } from './types';

/* ------------------------------ policy (BRC-F1) ------------------------------ */

export type LateFeeMode = 'FIXED' | 'PER_DAY' | 'PERCENT';

export interface LateFeeRule {
  mode: LateFeeMode;
  /** FIXED: one-time amount · PER_DAY: amount per overdue day */
  valuePaise?: Paise;
  /** PERCENT: basis points of the receivable's pending balance on the first penalty day (one-time, CL-03) */
  valueBp?: number;
  /** days after the due date before any penalty starts (default 0) */
  graceDays: number;
  /** maximum TOTAL penalty per parent receivable */
  capPaise?: Paise | null;
}

export interface LateFeePolicy extends LateFeeRule {
  id: string;
  /** a new version only affects days on/after its `effectiveFrom`; posted penalties are never rewritten */
  version: number;
  effectiveFrom: BusinessDate;
  effectiveTo?: BusinessDate | null;
  appliesToKinds: ReceivableKind[];
  /** opening balances are NEVER penalised unless this is explicitly true */
  applyToOpeningBalance: boolean;
  /** installment-specific penalty rules */
  installmentOverrides?: Record<number, Partial<LateFeeRule>>;
}

export interface PenaltyPosting {
  parentReceivableId: string;
  /** 'ONCE' or `D:YYYY-MM-DD` — deterministic → idempotent posting */
  periodKey: string;
  /** the day the penalty became due; used as the penalty receivable's due date */
  accrualDate: BusinessDate;
  amount: Paise;
  policyId: string;
  policyVersion: number;
}

export interface PaidEvent {
  date: BusinessDate;
  /** signed net allocation posted to the parent on `date` (reversals negative) */
  amount: Paise;
}

export interface ExistingPenalty {
  periodKey: string;
  amount: Paise;
}

export function validateLateFeeRule(rule: LateFeeRule): void {
  const bad = (m: string): never => {
    throw new FinanceError('LATE_FEE_POLICY_INVALID', m);
  };
  if (!Number.isInteger(rule.graceDays) || rule.graceDays < 0 || rule.graceDays > 3650)
    bad('grace days must be a whole number between 0 and 3650');
  if (
    rule.capPaise !== null &&
    rule.capPaise !== undefined &&
    (!Number.isSafeInteger(rule.capPaise) || rule.capPaise <= 0)
  )
    bad('the penalty cap must be greater than zero');
  if (rule.mode === 'PERCENT') {
    if (!Number.isInteger(rule.valueBp) || (rule.valueBp ?? 0) < 1 || (rule.valueBp ?? 0) > 10_000)
      bad('percentage must be between 0.01 % and 100 %');
  } else if (!Number.isSafeInteger(rule.valuePaise) || (rule.valuePaise ?? 0) <= 0) {
    bad('penalty amount must be greater than zero');
  }
}

const effectiveRule = (policy: LateFeePolicy, parent: Receivable): LateFeeRule => {
  const override =
    parent.installmentNo !== undefined
      ? policy.installmentOverrides?.[parent.installmentNo]
      : undefined;
  const merged: LateFeeRule = { ...policy, ...(override ?? {}) };
  validateLateFeeRule(merged);
  return merged;
};

/** pending of the parent on the END of `day`, reconstructed from the allocations posted up to then */
export function pendingOnDay(
  parent: Receivable,
  paidEvents: readonly PaidEvent[],
  day: BusinessDate,
): Paise {
  const paid = paidEvents.filter((e) => !isAfter(e.date, day)).reduce((s, e) => s + e.amount, 0);
  return Math.max(0, parent.payable - parent.adjusted - parent.transferred - paid);
}

export interface ComputePenaltyInput {
  parent: Receivable;
  policy: LateFeePolicy;
  asOf: BusinessDate;
  paidEvents: readonly PaidEvent[];
  existing: readonly ExistingPenalty[];
}

/**
 * Which penalties are still missing for `parent` up to `asOf`?
 * Pure and idempotent: postings whose periodKey already exists are never returned again, so a
 * nightly job (or a catch-up run) can call this any number of times.
 */
export function computePenaltyPostings(input: ComputePenaltyInput): PenaltyPosting[] {
  const { parent, policy, asOf } = input;
  if (parent.kind === 'PENALTY' || parent.paymentStatus === 'VOID') return [];
  if (
    parent.kind === 'OPENING_BALANCE'
      ? !policy.applyToOpeningBalance
      : !policy.appliesToKinds.includes(parent.kind)
  )
    return [];

  const rule = effectiveRule(policy, parent);
  const firstPenaltyDay = addDays(parent.dueDate, rule.graceDays + 1);
  const windowStart = maxDate(firstPenaltyDay, policy.effectiveFrom);
  const windowEnd = policy.effectiveTo ? minDate(asOf, policy.effectiveTo) : asOf;
  if (isAfter(windowStart, windowEnd)) return [];

  const have = new Set(input.existing.map((e) => e.periodKey));
  let capLeft =
    rule.capPaise === null || rule.capPaise === undefined
      ? Number.POSITIVE_INFINITY
      : rule.capPaise - input.existing.reduce((s, e) => s + e.amount, 0);
  const out: PenaltyPosting[] = [];
  const push = (periodKey: string, accrualDate: BusinessDate, amount: Paise): void => {
    if (have.has(periodKey) || amount <= 0 || capLeft <= 0) return;
    const clipped = Math.min(amount, capLeft);
    capLeft -= clipped;
    out.push({
      parentReceivableId: parent.id,
      periodKey,
      accrualDate,
      amount: clipped,
      policyId: policy.id,
      policyVersion: policy.version,
    });
  };

  if (rule.mode === 'FIXED' || rule.mode === 'PERCENT') {
    // one-time penalties are triggered on the first penalty day; a policy that starts later never penalises retroactively
    if (isBefore(firstPenaltyDay, policy.effectiveFrom) || isAfter(firstPenaltyDay, windowEnd))
      return [];
    const base = pendingOnDay(parent, input.paidEvents, firstPenaltyDay);
    if (base === 0) return [];
    push(
      'ONCE',
      firstPenaltyDay,
      rule.mode === 'FIXED' ? (rule.valuePaise ?? 0) : percentBp(base, rule.valueBp ?? 0),
    );
    return out;
  }

  for (const day of dateRange(windowStart, windowEnd)) {
    if (pendingOnDay(parent, input.paidEvents, day) === 0) continue; // nothing owed that day
    push(`D:${day}`, day, rule.valuePaise ?? 0);
  }
  return out;
}

export const penaltyDedupeKey = (parentId: string, periodKey: string): string =>
  `PENALTY:${parentId}:${periodKey}`;

/** Turn a posting into a separate PENALTY receivable (history from this moment on). */
export function buildPenaltyReceivable(
  parent: Receivable,
  posting: PenaltyPosting,
  idFactory: (dedupeKey: string) => string = (k) => k,
): Receivable {
  const key = penaltyDedupeKey(parent.id, posting.periodKey);
  return newReceivable({
    id: idFactory(key),
    studentId: parent.studentId,
    academicYearId: parent.academicYearId,
    classId: parent.classId,
    divisionId: parent.divisionId,
    kind: 'PENALTY',
    label: `Late fee – ${parent.label}`,
    dueDate: posting.accrualDate,
    parentReceivableId: parent.id,
    periodKey: posting.periodKey,
    components: [{ code: LATE_FEE_COMPONENT, name: 'Late fee', payable: posting.amount }],
    dedupeKey: key,
  });
}
