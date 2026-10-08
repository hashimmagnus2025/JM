import { percentBp, splitProportional, sumPaise, type Paise } from '@sfm/shared';
import { FinanceError } from './errors';
import { assertReceivable } from './invariants';
import { componentPending, recompute } from './receivable';
import type { Receivable } from './types';

export type AdjustmentMode = 'FIXED' | 'PERCENT_BP';
export type AdjustmentBasis = 'TOTAL_FEE' | 'COMPONENT' | 'RECEIVABLE';
export type AdjustmentDistribution =
  'PROPORTIONAL' | 'EARLIEST_FIRST' | 'LATEST_FIRST' | 'SPECIFIC';

export interface AdjustmentApplication {
  receivableId: string;
  componentCode: string;
  amount: Paise;
}

export interface AdjustmentRequest {
  mode: AdjustmentMode;
  /** paise for FIXED, basis points for PERCENT_BP (ignored for SPECIFIC) */
  value: number;
  basis: AdjustmentBasis;
  componentCode?: string;
  receivableId?: string;
  distribution: AdjustmentDistribution;
  /** required for distribution = SPECIFIC */
  specific?: readonly AdjustmentApplication[];
}

export interface ResolvedAdjustment {
  amount: Paise;
  applications: AdjustmentApplication[];
}

interface Cell {
  receivableId: string;
  componentCode: string;
  capacity: Paise;
  payable: Paise;
  order: number;
}

const byDue = (a: Receivable, b: Receivable): number =>
  a.dueDate < b.dueDate
    ? -1
    : a.dueDate > b.dueDate
      ? 1
      : (a.installmentNo ?? 0) - (b.installmentNo ?? 0) || (a.id < b.id ? -1 : 1);

function buildCells(req: AdjustmentRequest, receivables: readonly Receivable[]): Cell[] {
  let scope: Receivable[];
  if (req.basis === 'RECEIVABLE') {
    if (!req.receivableId)
      throw new FinanceError('ADJUSTMENT_INVALID', 'receivableId is required for basis RECEIVABLE');
    scope = receivables.filter((r) => r.id === req.receivableId && r.paymentStatus !== 'VOID');
  } else {
    // discounts/concessions apply to FEE receivables only (never to opening balance / penalties)
    scope = receivables.filter((r) => r.kind === 'INSTALLMENT' && r.paymentStatus !== 'VOID');
  }
  if (req.basis === 'COMPONENT' && !req.componentCode) {
    throw new FinanceError('ADJUSTMENT_INVALID', 'componentCode is required for basis COMPONENT');
  }
  const cells: Cell[] = [];
  let order = 0;
  for (const r of [...scope].sort(byDue)) {
    for (const c of r.components) {
      if (req.componentCode && c.code !== req.componentCode) continue;
      cells.push({
        receivableId: r.id,
        componentCode: c.code,
        capacity: Math.max(0, componentPending(c)),
        payable: c.payable,
        order: order++,
      });
    }
  }
  return cells;
}

/**
 * Resolve a discount/concession/scholarship/waiver request into exact per-receivable/component
 * applications. Σ applications = amount, no application exceeds what is still pending
 * (an adjustment can never reduce a receivable below what has already been paid — that would be a refund).
 */
export function resolveAdjustment(
  req: AdjustmentRequest,
  receivables: readonly Receivable[],
): ResolvedAdjustment {
  if (req.distribution === 'SPECIFIC') {
    const apps = req.specific ?? [];
    if (apps.length === 0)
      throw new FinanceError('ADJUSTMENT_INVALID', 'SPECIFIC distribution needs applications');
    const used = new Map<string, number>();
    const byId = new Map(receivables.map((r) => [r.id, r]));
    for (const a of apps) {
      if (!Number.isSafeInteger(a.amount) || a.amount <= 0) {
        throw new FinanceError(
          'ADJUSTMENT_AMOUNT_INVALID',
          'adjustment amounts must be positive whole paise',
        );
      }
      const r = byId.get(a.receivableId);
      const c = r?.components.find((x) => x.code === a.componentCode);
      if (!r || !c || r.paymentStatus === 'VOID') {
        throw new FinanceError(
          'ADJUSTMENT_INVALID',
          'adjustment targets an unknown receivable/component',
          {
            receivableId: a.receivableId,
            componentCode: a.componentCode,
          },
        );
      }
      const key = `${a.receivableId}|${a.componentCode}`;
      const total = (used.get(key) ?? 0) + a.amount;
      if (total > componentPending(c)) {
        throw new FinanceError(
          'ADJUSTMENT_EXCEEDS_PAYABLE',
          'adjustment is larger than what is still payable',
          {
            receivableId: a.receivableId,
            componentCode: a.componentCode,
          },
        );
      }
      used.set(key, total);
    }
    const applications = apps.map((a) => ({ ...a }));
    return { amount: sumPaise(applications.map((a) => a.amount)), applications };
  }

  const cells = buildCells(req, receivables);
  const capacity = sumPaise(cells.map((c) => c.capacity));

  let amount: Paise;
  if (req.mode === 'FIXED') {
    amount = req.value;
  } else {
    if (!Number.isInteger(req.value) || req.value < 1 || req.value > 10_000) {
      throw new FinanceError(
        'ADJUSTMENT_AMOUNT_INVALID',
        'percentage must be between 0.01 % and 100 %',
      );
    }
    amount = percentBp(sumPaise(cells.map((c) => c.payable)), req.value);
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new FinanceError(
      'ADJUSTMENT_AMOUNT_INVALID',
      'adjustment amount must be greater than zero',
    );
  }
  if (amount > capacity) {
    throw new FinanceError(
      'ADJUSTMENT_EXCEEDS_PAYABLE',
      'adjustment is larger than what is still payable',
      {
        amount,
        capacity,
      },
    );
  }

  const applications: AdjustmentApplication[] = [];
  if (req.distribution === 'PROPORTIONAL') {
    const shares = splitProportional(
      amount,
      cells.map((c) => c.capacity),
    );
    cells.forEach((c, i) => {
      const share = shares[i] ?? 0;
      if (share > 0)
        applications.push({
          receivableId: c.receivableId,
          componentCode: c.componentCode,
          amount: share,
        });
    });
  } else {
    // EARLIEST_FIRST / LATEST_FIRST: walk receivables in due order (or reverse), components in order
    const groups: Cell[][] = [];
    for (const c of cells) {
      const last = groups[groups.length - 1];
      if (last && last[0]?.receivableId === c.receivableId) last.push(c);
      else groups.push([c]);
    }
    const ordered = req.distribution === 'LATEST_FIRST' ? [...groups].reverse() : groups;
    let remaining = amount;
    for (const g of ordered) {
      for (const c of g) {
        if (remaining === 0) break;
        const take = Math.min(remaining, c.capacity);
        if (take > 0) {
          applications.push({
            receivableId: c.receivableId,
            componentCode: c.componentCode,
            amount: take,
          });
          remaining -= take;
        }
      }
    }
  }
  return { amount, applications };
}

function mutate(
  receivables: readonly Receivable[],
  applications: readonly AdjustmentApplication[],
  sign: 1 | -1,
): Receivable[] {
  const touched = new Set(applications.map((a) => a.receivableId));
  return receivables.map((orig) => {
    if (!touched.has(orig.id)) return orig;
    const r: Receivable = { ...orig, components: orig.components.map((c) => ({ ...c })) };
    for (const a of applications.filter((x) => x.receivableId === orig.id)) {
      const c = r.components.find((x) => x.code === a.componentCode);
      if (!c)
        throw new FinanceError('ADJUSTMENT_INVALID', 'unknown component', {
          componentCode: a.componentCode,
        });
      c.adjusted += sign * a.amount;
      if (c.adjusted < 0)
        throw new FinanceError('INVARIANT_VIOLATION', 'adjustment reversal below zero');
      if (componentPending(c) < 0) {
        throw new FinanceError(
          'ADJUSTMENT_EXCEEDS_PAYABLE',
          'adjustment is larger than what is still payable',
          {
            receivableId: r.id,
            componentCode: c.code,
          },
        );
      }
    }
    const done = recompute({ ...r, version: orig.version + 1 });
    assertReceivable(done);
    return done;
  });
}

/** Apply an APPROVED adjustment (reduces pending; the original `payable` is untouched → traceable). */
export const applyAdjustment = (
  receivables: readonly Receivable[],
  apps: readonly AdjustmentApplication[],
): Receivable[] => mutate(receivables, apps, 1);

/** Reverse a previously applied adjustment. */
export const reverseAdjustment = (
  receivables: readonly Receivable[],
  apps: readonly AdjustmentApplication[],
): Receivable[] => mutate(receivables, apps, -1);

/** Mark receivables targeted by a not-yet-approved adjustment (blocks the PAID state, CL-09). */
export function flagPendingAdjustment(
  receivables: readonly Receivable[],
  apps: readonly AdjustmentApplication[],
): Receivable[] {
  const ids = new Set(apps.map((a) => a.receivableId));
  return receivables.map((r) => (ids.has(r.id) ? { ...r, hasPendingAdjustment: true } : r));
}
