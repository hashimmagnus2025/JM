import { assertBusinessDate, type BusinessDate, type Paise } from '@sfm/shared';
import { FinanceError } from './errors';
import { assertReceivable } from './invariants';
import { buildOpeningBalanceReceivable } from './opening-balance';
import { componentPending, isPayable, recompute } from './receivable';
import type { Receivable } from './types';

export interface CarryForwardSource {
  receivable: Receivable;
  /** defaults to the whole pending balance */
  amount?: Paise;
}

export interface CarryForwardInput {
  /** id of the opening_balances document that will be created */
  openingBalanceId: string;
  sources: readonly CarryForwardSource[];
  targetAcademicYearId: string;
  effectiveDate: BusinessDate;
  reason: string;
  existingActiveOpeningBalanceInTarget: boolean;
  idFactory?: (dedupeKey: string) => string;
}

export interface CarryForwardPlan {
  /** source receivables after the transfer (pending reduced, `transferred` increased) */
  updatedSources: Receivable[];
  openingBalance: Receivable;
  transfers: { receivableId: string; academicYearId: string; amount: Paise }[];
  total: Paise;
}

/**
 * MANUAL, audited carry-forward of prior-year dues into an opening balance of a later year
 * (decision BRC-D1: never automatic). Total outstanding is unchanged:
 *   Σ pending(sources) falls by T, the new opening-balance receivable adds exactly T.
 * The transfer is neither a discount nor a collection — it is tracked in `transferred`.
 */
export function planCarryForward(input: CarryForwardInput): CarryForwardPlan {
  const bad = (msg: string, details?: Record<string, unknown>): never => {
    throw new FinanceError('CARRY_FORWARD_INVALID', msg, details);
  };
  if (input.reason.trim().length < 3) bad('A reason is required to carry dues forward.');
  assertBusinessDate(input.effectiveDate, 'effective date');
  if (input.sources.length === 0) bad('Select at least one due to carry forward.');
  const studentId = input.sources[0]?.receivable.studentId;
  const seen = new Set<string>();
  const updatedSources: Receivable[] = [];
  const transfers: CarryForwardPlan['transfers'] = [];
  let total = 0;

  for (const s of input.sources) {
    const r = s.receivable;
    if (r.studentId !== studentId) bad('All dues must belong to the same student.');
    if (seen.has(r.id)) bad('A due was selected twice.', { receivableId: r.id });
    seen.add(r.id);
    if (r.academicYearId === input.targetAcademicYearId) {
      bad('Dues can only be carried forward from a different academic year.', {
        receivableId: r.id,
      });
    }
    if (!isPayable(r))
      bad('This due has nothing pending to carry forward.', { receivableId: r.id });
    if (r.hasPendingAdjustment)
      bad('Resolve the pending adjustment before carrying this due forward.', {
        receivableId: r.id,
      });
    const amount = s.amount ?? r.pending;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > r.pending) {
      bad('Carry-forward amount must be between 1 paisa and the pending balance.', {
        receivableId: r.id,
        amount,
        pending: r.pending,
      });
    }
    // take the amount component by component, in the receivable's own order
    const next: Receivable = { ...r, components: r.components.map((c) => ({ ...c })) };
    let remaining = amount;
    for (const c of next.components) {
      if (remaining === 0) break;
      const take = Math.min(remaining, componentPending(c));
      c.transferred += take;
      remaining -= take;
    }
    const done = recompute({ ...next, version: r.version + 1 });
    assertReceivable(done);
    updatedSources.push(done);
    transfers.push({ receivableId: r.id, academicYearId: r.academicYearId, amount });
    total += amount;
  }

  const openingBalance = buildOpeningBalanceReceivable(
    {
      id: input.openingBalanceId,
      studentId: studentId as string,
      academicYearId: input.targetAcademicYearId,
      amount: total,
      effectiveDate: input.effectiveDate,
      source: 'CARRY_FORWARD',
      reason: input.reason,
    },
    { existingActive: input.existingActiveOpeningBalanceInTarget },
    input.idFactory,
  );
  return { updatedSources, openingBalance, transfers, total };
}
